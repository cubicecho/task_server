import { and, lt, ne } from "drizzle-orm";
import { db } from "../db/client.ts";
import { runs } from "../db/schema.ts";
import { loadSettings } from "../runner/llm.ts";

/** How often the retention setting is re-read and acted on. */
const INTERVAL_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | undefined;

/**
 * Deletes runs older than the retention setting, and answers with how many went.
 *
 * `runRetentionDays` of zero — the default — keeps everything, which is the right default for a
 * server someone has just started and the wrong one for a server that has been running a
 * five-minute cron for a year. A run row holds the whole output and error text, so this is the
 * only thing standing between that task and a disk.
 *
 * A run still going is never deleted however old it looks: `startedAt` is when it began, and a
 * long run that outlived the window has a row someone is still watching and a `finish` still to
 * come. Its steps go with it — `run_steps.runId` cascades — and the run's trigger and task do
 * not, being on the other end of the foreign key.
 */
export async function prune(): Promise<number> {
  const { runRetentionDays } = await loadSettings();
  if (runRetentionDays <= 0) return 0;

  const cutoff = new Date(Date.now() - runRetentionDays * 24 * 60 * 60 * 1000);
  const gone = await db
    .delete(runs)
    .where(and(lt(runs.startedAt, cutoff), ne(runs.status, "running")))
    .returning({ id: runs.id });

  if (gone.length) {
    console.log(`[cleanup] removed ${gone.length} run(s) older than ${runRetentionDays}d`);
  }
  return gone.length;
}

/**
 * Prunes now, then hourly.
 *
 * Hourly rather than on a cron of its own because the setting is a age in days: nothing about
 * it is precise enough to be worth a schedule, and reading it each time is what lets a change
 * in the UI take effect without a restart.
 */
export function start() {
  stop();
  void run();
  timer = setInterval(run, INTERVAL_MS);
  // Nothing should be held open by this: a server with no other work to do should still exit.
  timer.unref?.();
}

const run = () => {
  void prune().catch((error: unknown) => console.error("[cleanup] failed:", error));
};

export function stop() {
  clearInterval(timer);
  timer = undefined;
}
