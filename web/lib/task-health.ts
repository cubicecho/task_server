import type { StatusQuery } from "@/__generated__/graphql/graphql";

export type StatusTask = StatusQuery["tasks"][number];

/**
 * Which heap a task is in, in the order the page shows them.
 *
 * The words are deliberately not the run statuses. `ok`, `error` and `stopped` describe one
 * run; what a person opening this page wants is what is true of the *task* now — and two of
 * the answers worth having are not run statuses at all. A task nothing arms never fails; it
 * just never happens, and on the Tasks page it looks exactly like one that is working. A task
 * being turned away has a perfectly healthy last run and a pile of firings it dropped, and a
 * task whose firing is still in the queue has a last run that finished hours ago and says
 * nothing about the one it owes.
 */
export const HEALTH = ["refused", "broken", "running", "waiting", "off", "manual", "fine"] as const;

export type Health = (typeof HEALTH)[number];

const at = (iso: string) => new Date(iso).getTime();

/**
 * A task's heap, most alarming answer first.
 *
 * A refusal outranks everything, and has to: a task that fires faster than it runs is nearly
 * always also running, so ranking `running` above would hide every one of them behind the fact
 * that the task is busy. `broken` outranks `off` for the same kind of reason — silencing a task
 * that failed is not the same as fixing it, and the row says it is disabled regardless.
 *
 * `running` and `broken` never compete: both read the newest run that actually ran, so a task
 * that is running now cannot also be showing the error before it. Nor can `running` and
 * `waiting`: a firing that met a busy *task* is a skip, and only one that met a full server
 * queues, so a task with a row waiting is by definition not the task holding a slot.
 */
export function taskHealth(task: StatusTask): Health {
  const last = task.last[0];
  const skip = task.collision[0];

  if (skip) {
    // `finishedAt` on a skipped row moves with the latest firing it stands for, so this asks
    // whether anything has actually run since the last time one was turned away.
    const turnedAway = at(skip.finishedAt ?? skip.startedAt);
    if (!last || turnedAway > at(last.startedAt)) return "refused";
  }
  if (last?.status === "running") return "running";
  if (last?.status === "error") return "broken";
  // Nothing is lost — the row runs when a slot comes back — but the task is behind, and the
  // last run finished cleanly and would otherwise read as `fine`.
  if (task.waiting[0]) return "waiting";
  if (!task.enabled) return "off";
  if (!task.triggers.some((trigger) => trigger.enabled)) return "manual";
  return "fine";
}

/** Every heap at nought, which is what a server holding no tasks has to say. */
const noneYet = (): Record<Health, number> =>
  Object.fromEntries(HEALTH.map((health) => [health, 0])) as Record<Health, number>;

export function tally(tasks: StatusTask[]): Record<Health, number> {
  const counts = noneYet();
  for (const task of tasks) counts[taskHealth(task)] += 1;
  return counts;
}

/** The heaps that mean something is wrong, which is what the page exists to answer. */
export const WRONG: Health[] = ["refused", "broken"];

/**
 * The tasks the list holds. With nothing picked it is the tasks something is wrong with, because
 * that is the question the page was opened to answer. Picking a tile is how you ask a narrower
 * one — and how you see the heaps that are not problems at all.
 */
export const tasksShown = (tasks: StatusTask[], selected: Health | null): StatusTask[] =>
  tasks.filter((task) => {
    const health = taskHealth(task);
    return selected ? health === selected : WRONG.includes(health);
  });

/**
 * The failed runs no task in the list already answers for.
 *
 * A task standing in `broken` says its own error, so a run listed as well would be the same
 * fault twice. What is left is the failures nothing else accounts for: a task that has run
 * successfully since, or one that has been deleted.
 */
export function unexplainedFailures(
  tasks: StatusTask[],
  failures: StatusQuery["failures"],
): StatusQuery["failures"] {
  const accounted = new Set(
    tasks.filter((task) => taskHealth(task) === "broken").map((task) => task.id),
  );
  return failures.filter((failure) => !failure.task || !accounted.has(failure.task.id));
}
