import { eq } from "drizzle-orm";
import { type ScheduledTask, schedule, validate } from "node-cron";
import { errorMessage } from "../../shared/errors.ts";
import { db } from "../db/client.ts";
import { tasks, triggers } from "../db/schema.ts";
import { fireTask } from "../runner/run.ts";

export const isValidCron = (expression: string) => validate(expression);

interface Entry {
  task: ScheduledTask;
  cron: string;
  timezone: string;
  taskId: string;
}

/** Keyed by trigger id. */
const entries = new Map<string, Entry>();

export interface ScheduleEntry {
  triggerId: string;
  taskId: string;
  cron: string;
  nextRun: string | null;
}

/**
 * Rebuilds the live schedule from the `triggers` table.
 *
 * A trigger whose expression and zone are unchanged keeps its existing task rather than being
 * torn down and recreated, so an unrelated edit elsewhere does not shift when a job next
 * fires. Called on boot and — debounced — after any write that could change the schedule.
 */
export async function sync() {
  const rows = await db
    .select({
      id: triggers.id,
      taskId: triggers.taskId,
      kind: triggers.kind,
      cron: triggers.cron,
      timezone: triggers.timezone,
      enabled: triggers.enabled,
      taskEnabled: tasks.enabled,
    })
    .from(triggers)
    .innerJoin(tasks, eq(triggers.taskId, tasks.id));

  // A disabled task disables its triggers with it: the switch on the task is the one a user
  // reaches for to stop it, and a trigger that kept firing past it would be a bug, not a
  // feature. Event triggers are left out because they are not on a clock at all — `POST
  // /webhooks/<id>` in `server/webhooks.ts` is what dispatches those, and it applies the same
  // two switches when it does.
  const live = rows.filter(
    (row) => row.kind === "cron" && row.enabled && row.taskEnabled && row.cron,
  );

  for (const [id, entry] of entries) {
    if (!live.some((row) => row.id === id)) {
      void entry.task.destroy();
      entries.delete(id);
    }
  }

  for (const row of live) {
    const existing = entries.get(row.id);
    if (
      existing &&
      existing.cron === row.cron &&
      existing.timezone === row.timezone &&
      existing.taskId === row.taskId
    ) {
      continue;
    }
    void existing?.task.destroy();
    entries.delete(row.id);

    if (!validate(row.cron)) {
      console.error(`[cron] trigger ${row.id}: invalid expression: ${row.cron}`);
      continue;
    }
    const task = schedule(
      row.cron,
      () => {
        // Nothing is waiting on a tick, so everything it comes to has to be written down where
        // it can be found later: the run row for a run, a `queued` row for one waiting on a
        // slot, a `skipped` row for a task that was still busy, and the log for the failures
        // that leave no row at all.
        void fireTask(row.taskId, row.id).catch((error: unknown) => {
          console.error(`[cron] trigger ${row.id}: ${errorMessage(error)}`);
        });
      },
      {
        name: row.id,
        // A run that overruns its own interval must not stack up behind itself.
        noOverlap: true,
        ...(row.timezone ? { timezone: row.timezone } : {}),
      },
    );
    entries.set(row.id, { task, cron: row.cron, timezone: row.timezone, taskId: row.taskId });
  }
}

let pending: NodeJS.Timeout | undefined;
/** A write has landed that the live schedule has not been rebuilt for yet. */
let owed = false;

async function settle() {
  owed = false;
  await sync().catch((error) => console.error("[cron] sync failed:", error));
}

/**
 * Re-syncs shortly after a write, rather than during it.
 *
 * Write hooks run inside the mutation's transaction, so reading the table from there would
 * either see pre-commit state or deadlock. Waiting a tick past the commit coalesces a batch of
 * edits into one rebuild, and nothing that fires on a schedule cares which side of 50ms it was
 * armed on.
 */
export function syncSoon() {
  owed = true;
  clearTimeout(pending);
  pending = setTimeout(() => void settle(), 50);
}

/**
 * Pays off a debounced rebuild now, for a reader that would otherwise be shown the schedule as
 * it stood before its own write.
 *
 * The delay above is invisible to the UI, which refetches on its own and has a person's reaction
 * time in front of it. It is not invisible to an agent on `/mcp`: `create_trigger` then
 * `schedule` is the obvious way to confirm a trigger is armed, and those two calls arrive
 * milliseconds apart — twelve `schedule` calls in a row came back empty for a trigger that had
 * already been written. An empty answer there does not read as "ask again", it reads as "it did
 * not take".
 *
 * The debounce is deliberately left standing rather than disarmed. It may have been set by
 * someone else's write whose transaction has not committed yet, which this rebuild would miss;
 * letting the timer fire again costs one redundant sync and keeps that write's guarantee intact.
 */
export async function flush() {
  if (owed) await settle();
}

export function state(): ScheduleEntry[] {
  return [...entries].map(([triggerId, entry]) => ({
    triggerId,
    taskId: entry.taskId,
    cron: entry.cron,
    nextRun: entry.task.getNextRun()?.toISOString() ?? null,
  }));
}

export function stop() {
  clearTimeout(pending);
  for (const entry of entries.values()) void entry.task.destroy();
  entries.clear();
}
