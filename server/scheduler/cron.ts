import { eq } from "drizzle-orm";
import { type ScheduledTask, schedule, validate } from "node-cron";
import { db } from "../db/client.ts";
import { tasks, triggers } from "../db/schema.ts";
import { runTask } from "../runner/run.ts";

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
  // feature. Event triggers are stored but nothing dispatches them yet.
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
        void runTask(row.taskId, row.id);
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

/**
 * Re-syncs shortly after a write, rather than during it.
 *
 * Write hooks run inside the mutation's transaction, so reading the table from there would
 * either see pre-commit state or deadlock. Waiting a tick past the commit costs nothing —
 * nobody is watching for the next fire time to update within the millisecond — and coalesces
 * a batch of edits into one rebuild.
 */
export function syncSoon() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    void sync().catch((error) => console.error("[cron] sync failed:", error));
  }, 50);
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
