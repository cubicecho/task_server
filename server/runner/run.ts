import { and, eq, isNull, sql } from "drizzle-orm";
import { errorMessage } from "../../shared/errors.ts";
import { db } from "../db/client.ts";
import { type Run, runs, steps, tasks } from "../db/schema.ts";
import { emit } from "./events.ts";
import { runFlow } from "./flow.ts";
import { loadSettings } from "./llm.ts";

/**
 * Tasks in flight, so a slow task cannot be started on top of itself — and so a run can be
 * called off. The controller is the only handle on a run once it has started: the loop is
 * inside `runAgent`, and nothing else can reach it.
 */
const inFlight = new Map<string, { runId: string; controller: AbortController }>();

/**
 * A task asked to start while a run of it is already going. Its own class so a trigger can
 * tell the one refusal it expects from the ones that mean something is wrong.
 */
export class TaskBusyError extends Error {
  override readonly name = "TaskBusyError";
}

/** Task ids running right now. A task cannot be deleted while it is one of them. */
export const runningTaskIds = () => new Set(inFlight.keys());

/** Run ids in flight. Deleting one would leave `finish` with no row to write the outcome to. */
export const runningRunIds = () => new Set([...inFlight.values()].map((entry) => entry.runId));

/**
 * Calls off a running task. Returns false if it was not running — which is the honest answer
 * to a stale button, not an error.
 *
 * The request in flight is aborted at once; a tool call already handed to an MCP server has
 * to come back on its own, and the loop stops on the step after.
 */
export function stopTask(taskId: string): boolean {
  const entry = inFlight.get(taskId);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

/**
 * Executes one task and records the run.
 *
 * The run row is written *before* the agent starts, so a task that is running right now is
 * visible in the UI rather than appearing only once it finishes — which for a task that hangs
 * is never. The row is then updated in place with the outcome.
 *
 * What actually runs is the task's flow: its prompt, then whatever steps hang off it. A task
 * with no steps is one step, which is the whole of what this used to do.
 */
export async function runTask(taskId: string, triggerId?: string): Promise<Run> {
  const { done } = await startTask(taskId, triggerId);
  return await done;
}

/**
 * Starts a task and hands back the run it created, without waiting for it to finish.
 *
 * The split is where the two honest answers are. Everything up to the run row is the refusal —
 * no such task, or one already in flight — and it is known immediately. Everything after it is
 * the run, which may take minutes. A caller that has to say what it started, rather than what it
 * would have liked to start, needs the first without paying for the second: awaiting this
 * settles once the run exists, and `done` carries the outcome to whoever wants it.
 *
 * `done` is a promise nobody is obliged to await, so it is written not to reject: every failure
 * inside the run is recorded on the run row and comes back as a finished `Run`. Only a database
 * that cannot write that row throws, which is why the webhook still attaches a `catch`.
 */
export async function startTask(
  taskId: string,
  triggerId?: string,
  payload?: unknown,
): Promise<{ run: Run; done: Promise<Run> }> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error(`no task with id ${taskId}`);
  if (inFlight.has(taskId)) throw new TaskBusyError(`task "${task.name}" is already running`);
  // Read once, before the run starts: a flow edited halfway through would make the run's own
  // account of itself untrue.
  const flow = await db.select().from(steps).where(eq(steps.taskId, taskId));

  // The payload is stored as well as passed on. The prompt the agent saw depended on it, so a
  // run that kept its output and not its input could not be read back or reproduced.
  const [run] = await db
    .insert(runs)
    .values({ taskId, triggerId: triggerId ?? null, status: "running", payload: payload ?? null })
    .returning();

  const controller = new AbortController();
  inFlight.set(taskId, { runId: run.id, controller });
  return { run, done: execute({ run, task, flow, payload, controller }) };
}

/**
 * What a trigger firing came to: a run that started, or a run row saying why one did not.
 *
 * `started` is the discriminant rather than the absence of `done`, because both arms carry a
 * real run row and the caller's question is which kind it is.
 */
export type Fired =
  | { started: true; run: Run; done: Promise<Run> }
  | { started: false; run: Run; reason: string };

/**
 * Fires a task on behalf of a trigger, and records the firing either way.
 *
 * `startTask` refuses a task that is already running, which is right for a person or an agent
 * asking for a run — they are told so on the spot. Nothing is watching when a cron tick or a
 * webhook delivery meets the same refusal, and it used to leave no trace but a log line: no run
 * row, nothing in the history, and a task that appears simply not to have fired. That is
 * indistinguishable from a trigger that is broken, which is the thing someone opening the Runs
 * page is usually trying to rule out.
 *
 * So the skip is written down as a run of its own — started and finished in the same instant,
 * `status: "skipped"`, with the refusal in `error`. It says the trigger worked and the task did
 * not run, which is neither a success nor a failure and is exactly what happened.
 *
 * Only the busy case becomes a row. A task that does not exist has nothing to hang a run off,
 * and a database that cannot be written to cannot be told about it either; both still throw, and
 * both callers log.
 *
 * One row per collision, not per firing. A webhook posted every second at a task that takes five
 * minutes is one fact repeated three hundred times, and three hundred rows of it would bury the
 * runs someone came to the page to read. So a second firing that meets the same trigger, the same
 * task and the same run in the way finds its row and bumps `attempts` instead. The payload kept
 * on it is the latest one, which is the delivery whoever is asking has just made.
 */
export async function fireTask(
  taskId: string,
  triggerId?: string,
  payload?: unknown,
): Promise<Fired> {
  // Read before the throw can be handled: the entry is what the skip is *about*, and the run
  // may finish and clear it at any moment after.
  const blocking = inFlight.get(taskId)?.runId;
  try {
    const { run, done } = await startTask(taskId, triggerId, payload);
    return { started: true, run, done };
  } catch (error) {
    if (!(error instanceof TaskBusyError)) throw error;
    const reason = errorMessage(error);
    const run = await recordSkip({ taskId, triggerId, payload, reason, blocking });
    return { started: false, run, reason };
  }
}

/**
 * Writes the skip, or adds this firing to the one already standing for the same collision.
 *
 * Without a blocking run id there is nothing to collapse against — the run that refused this
 * one finished between the refusal and here — so that case always writes its own row rather
 * than guessing which earlier skip it belongs with.
 *
 * `finishedAt` moves to the latest firing while `startedAt` stays at the first, so the row spans
 * the collisions it stands for instead of naming one arbitrary instant in the middle of them.
 */
async function recordSkip({
  taskId,
  triggerId,
  payload,
  reason,
  blocking,
}: {
  taskId: string;
  triggerId?: string;
  payload?: unknown;
  reason: string;
  blocking?: string;
}): Promise<Run> {
  if (blocking) {
    const [existing] = await db
      .update(runs)
      .set({
        attempts: sql`${runs.attempts} + 1`,
        payload: payload ?? null,
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(runs.status, "skipped"),
          eq(runs.taskId, taskId),
          eq(runs.blockedBy, blocking),
          triggerId ? eq(runs.triggerId, triggerId) : isNull(runs.triggerId),
        ),
      )
      .returning();
    if (existing) return existing;
  }

  const [run] = await db
    .insert(runs)
    .values({
      taskId,
      triggerId: triggerId ?? null,
      status: "skipped",
      error: reason,
      payload: payload ?? null,
      blockedBy: blocking ?? null,
      finishedAt: new Date(),
    })
    .returning();
  return run;
}

/** The run itself, once `startTask` has decided there is going to be one. */
async function execute({
  run,
  task,
  flow,
  payload,
  controller,
}: {
  run: Run;
  task: typeof tasks.$inferSelect;
  flow: (typeof steps.$inferSelect)[];
  payload?: unknown;
  controller: AbortController;
}): Promise<Run> {
  // Everything the run says as it goes, for anyone watching it — see `runner/events.ts`.
  const onEvent = (event: Parameters<typeof emit>[1]) => emit(run.id, event);
  onEvent({ kind: "notice", text: `${task.name} started` });
  try {
    const config = await loadSettings();
    const result = await runFlow({
      runId: run.id,
      task,
      steps: flow,
      config,
      payload,
      signal: controller.signal,
      onEvent,
    });
    onEvent({ kind: "done", ok: true, text: "finished" });
    return await finish(run.id, {
      status: "ok",
      output: result.output,
      toolCalls: result.toolCalls,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    });
  } catch (error) {
    // A stopped run is not a failed one: it did what was asked of it, which was to stop.
    if (controller.signal.aborted) {
      console.log(`[run] ${task.name}: stopped`);
      onEvent({ kind: "done", ok: false, text: "stopped" });
      return await finish(run.id, { status: "stopped" });
    }
    const message = errorMessage(error);
    console.error(`[run] ${task.name}: ${message}`);
    onEvent({ kind: "done", ok: false, text: message });
    return await finish(run.id, { status: "error", error: message });
  } finally {
    inFlight.delete(task.id);
  }
}

async function finish(runId: string, patch: Partial<Run>): Promise<Run> {
  const [updated] = await db
    .update(runs)
    .set({ ...patch, finishedAt: new Date() })
    .where(eq(runs.id, runId))
    .returning();
  return updated;
}
