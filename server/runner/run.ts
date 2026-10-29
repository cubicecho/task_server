import { emit, errorMessage, type RunEventInput, RunEventKind } from "@cubicecho/agent-core";
import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { type Run, runs, type Step, steps, type Task, tasks } from "../db/schema.ts";
import { persistCapabilities } from "./capabilities.ts";
import { runFlow } from "./flow.ts";
import { type HookSession, hookSession } from "./hooks.ts";
import { loadSettings } from "./llm.ts";
import { configForTask } from "./profile.ts";

/**
 * Tasks in flight, so a slow task cannot be started on top of itself — and so a run can be
 * called off. The controller is the only handle on a run once it has started: the loop is
 * inside `runAgent`, and nothing else can reach it.
 */
const inFlight = new Map<string, Slot>();

/** A task's claim on a run. `runId` is empty for the width of the insert that makes the run. */
interface Slot {
  runId: string;
  controller: AbortController;
}

/**
 * A start that was refused because something was already running — not because anything is
 * wrong. Its own class so a trigger can tell the refusals it expects from the faults it does
 * not, and two of them because the two answers are different: one is about this task, the
 * other about the server, and the person reading the skipped run needs to know which.
 */
export class RunRefusedError extends Error {}

export class TaskBusyError extends RunRefusedError {
  override readonly name = "TaskBusyError";
}

export class AtCapacityError extends RunRefusedError {
  override readonly name = "AtCapacityError";
}

/** Task ids running right now. A task cannot be deleted while it is one of them. */
export const runningTaskIds = () => new Set(inFlight.keys());

/**
 * Run ids in flight. Deleting one would leave `finish` with no row to write the outcome to.
 *
 * A slot claimed a moment before its run row exists carries an empty id, and that is dropped
 * rather than returned: there is no such run to protect yet, and an empty string in a set of
 * ids is a value some caller will eventually compare against by accident.
 */
export const runningRunIds = () =>
  new Set([...inFlight.values()].map((entry) => entry.runId).filter(Boolean));

/**
 * Calls off a running task. Returns false if it was not running — which is the honest answer
 * to a stale button, not an error.
 *
 * The request in flight is aborted at once; a tool call already handed to an MCP server has
 * to come back on its own, and the loop stops on the step after.
 */
export function stopTask(taskId: string): boolean {
  const entry = inFlight.get(taskId);
  if (!entry) {
    return false;
  }
  entry.controller.abort();
  return true;
}

/**
 * Executes one task's flow and records the run.
 *
 * The run row is written before the agent starts and updated in place, so a task that is
 * running, or hanging, is visible in the UI. A `payload` is a body handed over by the caller
 * and is treated exactly as a webhook's: stored on the run, rendered as `{{event}}`.
 * `triggerId` stays empty for those, because a run that claimed a webhook nobody posted to
 * would misread the history.
 */
export async function runTask(taskId: string, triggerId?: string, payload?: unknown): Promise<Run> {
  const { done } = await startTask(taskId, triggerId, payload);
  return await done;
}

/**
 * Re-read every time rather than cached, so a limit changed in the UI applies to the next run
 * and not to the next restart.
 */
const capacity = async () => (await loadSettings()).maxConcurrentRuns;

/** Whether every slot is taken. A limit of zero is no ceiling, so nothing fills it. */
const isFull = (limit: number) => limit > 0 && inFlight.size >= limit;

/** The rows one trigger wrote — or, with no trigger, the ones started by hand. */
const firedBy = (triggerId?: string) =>
  triggerId ? eq(runs.triggerId, triggerId) : isNull(runs.triggerId);

/**
 * Takes the slot a run needs, or refuses.
 *
 * Synchronous on purpose, and it must stay that way: a check separated from its claim by an
 * `await` is not a limit, because two firings that arrive in the same tick both pass it and both
 * start. `runId` is filled in a moment later — what the entry has to carry from this instant is
 * that the slot is spoken for, and the controller that can call the run off.
 */
function claim(taskId: string, name: string, limit: number) {
  if (inFlight.has(taskId)) {
    throw new TaskBusyError(`task "${name}" is already running`);
  }
  if (isFull(limit)) {
    throw new AtCapacityError(`${inFlight.size} runs already going, and the limit is ${limit}`);
  }
  const entry: Slot = { runId: "", controller: new AbortController() };
  inFlight.set(taskId, entry);
  return entry;
}

/**
 * Starts a task and hands back the run it created, without waiting for it to finish.
 *
 * Awaiting this settles once the run row exists, so a refusal is known immediately and a caller
 * can say what it started without paying for the run. `done` carries the outcome and is written
 * not to reject: every failure inside the run is recorded on the row and comes back as a
 * finished `Run`. Only a database that cannot write that row throws.
 */
export async function startTask(
  taskId: string,
  triggerId?: string,
  payload?: unknown,
): Promise<{ run: Run; done: Promise<Run> }> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) {
    throw new Error(`no task with id ${taskId}`);
  }
  const entry = claim(task.id, task.name, await capacity());

  try {
    // Read once, before the run starts: a flow edited halfway through would make the run's own
    // account of itself untrue.
    const flow = await db.select().from(steps).where(eq(steps.taskId, taskId));

    // The payload is stored as well as passed on. The prompt the agent saw depended on it, so a
    // run that kept its output and not its input could not be read back or reproduced.
    const [run] = await db
      .insert(runs)
      .values({ taskId, triggerId: triggerId ?? null, status: "running", payload: payload ?? null })
      .returning();

    entry.runId = run.id;
    return { run, done: execute({ run, task, flow, payload, controller: entry.controller }) };
  } catch (error) {
    // The slot was claimed before there was a run to hang it on, so a failure between the two
    // has to give it back — otherwise a database that hiccups once leaks a slot for the life of
    // the process, and the limit ratchets down to nothing.
    inFlight.delete(taskId);
    throw error;
  }
}

/**
 * What a trigger firing came to: a run that started, or a run row saying why one did not.
 *
 * `started` is the discriminant rather than the absence of `done`, because both arms carry a
 * real run row and the caller's question is which kind it is.
 */
export type Fired =
  | { started: true; run: Run; done: Promise<Run> }
  | { started: false; queued: boolean; run: Run; reason: string };

/**
 * Fires a task on behalf of a trigger, and records the firing either way.
 *
 * Nothing is watching a cron tick or a webhook delivery, so a refusal becomes a row instead of a
 * log line: a busy task is a `skipped` run with the reason in `error`, and a full server a
 * `queued` one. A missing task or an unwritable database still throws, and both callers log.
 * A skip is one row per collision, not per firing: a second firing that meets the same trigger,
 * task and blocking run bumps `attempts` and leaves its payload, the latest, on that row.
 */
export async function fireTask(
  taskId: string,
  triggerId?: string,
  payload?: unknown,
): Promise<Fired> {
  // Read before the throw can be handled: the entry is what the skip is *about*, and the run
  // may finish and clear it at any moment after.
  //
  // For a task meeting itself that is its own run. For one meeting a full server there is no
  // single run in the way, so it is the oldest — the map is in insertion order, and the oldest
  // is the run whose finishing is most likely to free the slot. Either way the skip has a run
  // to collapse against, which is what stops a webhook posted every second at a busy server
  // writing a row a second.
  const blocking = inFlight.get(taskId)?.runId ?? [...inFlight.values()][0]?.runId;
  try {
    const { run, done } = await startTask(taskId, triggerId, payload);
    return { started: true, run, done };
  } catch (error) {
    if (!(error instanceof RunRefusedError)) {
      throw error;
    }
    const reason = errorMessage(error);
    // A full server is a wait; a task meeting itself is a collision. Only the first is worth
    // holding on to — see `enqueue`.
    if (error instanceof AtCapacityError) {
      const run = await enqueue({ taskId, triggerId, payload, reason });
      return { started: false, queued: true, run, reason };
    }
    const run = await recordSkip({ taskId, triggerId, payload, reason, blocking });
    return { started: false, queued: false, run, reason };
  }
}

/**
 * Writes the firing down as work still to do, or folds it into the one already waiting.
 *
 * A firing that meets a full server waits, where a task meeting itself stays a skip. The queue
 * is the run table: a `queued` row becomes `running` in place, so the id a webhook was told is
 * the id that holds the output, the wait survives a restart, and it shows on the Runs page.
 * There is one row per waiting trigger, keeping the newest payload and counting the firings it
 * stands for in `attempts`.
 */
async function enqueue({
  taskId,
  triggerId,
  payload,
  reason,
}: {
  taskId: string;
  triggerId?: string;
  payload?: unknown;
  reason: string;
}): Promise<Run> {
  const [waiting] = await db
    .update(runs)
    .set({ attempts: sql`${runs.attempts} + 1`, payload: payload ?? null, error: reason })
    .where(and(eq(runs.status, "queued"), eq(runs.taskId, taskId), firedBy(triggerId)))
    .returning();
  if (waiting) {
    return waiting;
  }

  const [run] = await db
    .insert(runs)
    .values({
      taskId,
      triggerId: triggerId ?? null,
      status: "queued",
      // Why it is waiting, in the same column a skip says why it did not run. Cleared when the
      // run starts: by then it is not true of the row any more.
      error: reason,
      payload: payload ?? null,
    })
    .returning();
  return run;
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
          firedBy(triggerId),
        ),
      )
      .returning();
    if (existing) {
      return existing;
    }
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

/**
 * Starts whatever the server now has room for, oldest firing first.
 *
 * Drains are chained, never concurrent: two runs finishing in the same tick would otherwise
 * both pick the same waiting row. The chain never rejects, since a link that threw would take
 * every later drain with it. A task already in flight is stepped over, and a drain that cannot
 * start what it picked stops there and leaves the rest for the next run to finish.
 */
export function drainQueue(): Promise<void> {
  draining = draining.then(drainOnce);
  return draining;
}

let draining: Promise<void> = Promise.resolve();

/**
 * How long past a write its `onWrite` hook waits before reading the table back.
 *
 * A hook runs inside the mutation's transaction, so a read made from one sees the row as it stood
 * before the write. The scheduler's rebuild and the queue's drain both wait this out, and a batch
 * of edits inside it is one rebuild.
 */
export const AFTER_COMMIT_MS = 50;

/**
 * A drain after the write that made it possible has landed: called from a hook, it would read the
 * limit as it stood before the write that raised it.
 */
export function drainSoon() {
  clearTimeout(pendingDrain);
  pendingDrain = setTimeout(() => void drainQueue(), AFTER_COMMIT_MS);
}

let pendingDrain: ReturnType<typeof setTimeout>;

async function drainOnce(): Promise<void> {
  try {
    for (;;) {
      if (isFull(await capacity())) {
        return;
      }

      const busy = [...inFlight.keys()];
      const [next] = await db
        .select()
        .from(runs)
        .where(
          busy.length
            ? and(eq(runs.status, "queued"), notInArray(runs.taskId, busy))
            : eq(runs.status, "queued"),
        )
        // Oldest first: the queue is a queue. `startedAt` on a waiting row is when it was
        // written down, and is reset to the real start when it runs.
        .orderBy(asc(runs.startedAt))
        .limit(1);

      if (!next || !(await startQueued(next))) {
        return;
      }
    }
  } catch (error) {
    console.error(`[queue] ${errorMessage(error)}`);
  }
}

/**
 * Turns one waiting row into a running one, in place, so the run id a webhook was told is the
 * id that carries the output.
 *
 * `startedAt` moves to the real start, or the duration would include the wait. A task disabled
 * while its run waited is finished as `skipped` instead: honouring "stop firing this" minutes
 * late is not honouring it. False means the slot went to something else, which ends the drain.
 */
async function startQueued(waiting: Run): Promise<boolean> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, waiting.taskId)).limit(1);
  if (!task) {
    return false;
  }
  if (!task.enabled) {
    await finish(waiting.id, {
      status: "skipped",
      error: "the task was disabled while this was waiting",
    });
    return true;
  }

  let entry: Slot;
  try {
    entry = claim(task.id, task.name, await capacity());
  } catch (error) {
    if (error instanceof RunRefusedError) {
      return false;
    }
    throw error;
  }

  try {
    const flow = await db.select().from(steps).where(eq(steps.taskId, task.id));
    const [run] = await db
      .update(runs)
      // The reason it was waiting stops being true of the row the moment it is not.
      .set({ status: "running", error: "", startedAt: new Date() })
      .where(and(eq(runs.id, waiting.id), eq(runs.status, "queued")))
      .returning();
    // Deleted, or drained by someone else, between the pick and the update. The slot goes back
    // and the drain carries on with whatever is behind it.
    if (!run) {
      inFlight.delete(task.id);
      return true;
    }

    entry.runId = run.id;
    // Nobody is waiting on this one: the caller was a webhook that answered minutes ago, or a
    // cron tick that answered nobody. What it comes to is on the run row either way.
    void execute({
      run,
      task,
      flow,
      payload: run.payload,
      controller: entry.controller,
    }).catch((error: unknown) => console.error(`[queue] ${task.name}: ${errorMessage(error)}`));
    return true;
  } catch (error) {
    inFlight.delete(task.id);
    throw error;
  }
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
  task: Task;
  flow: Step[];
  payload?: unknown;
  controller: AbortController;
}): Promise<Run> {
  // Everything the run says as it goes, for anyone watching it — see the event bus in `@cubicecho/agent-core`.
  const onEvent = (event: RunEventInput) => emit(run.id, event);
  onEvent({ kind: RunEventKind.Notice, text: `${task.name} started` });
  // Made once the run's scope is known, and ended — not awaited — once its outcome is written:
  // a memory server filing the last step is no reason for the slot to stay taken.
  let hooks: HookSession | undefined;
  try {
    // The settings row, with the task's agent profile laid over it — endpoint, model and every
    // ceiling. A task with no profile gets the row itself, which is what every run used to get.
    const { config, servers } = await configForTask(task);
    hooks = hookSession({ runId: run.id, task, triggerId: run.triggerId, servers });
    const result = await runFlow({
      runId: run.id,
      task,
      steps: flow,
      config,
      servers,
      payload,
      hooks,
      signal: controller.signal,
      onEvent,
    });
    onEvent({ kind: RunEventKind.Done, ok: true, text: "finished" });
    void hooks.end("ok", result.output);
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
      onEvent({ kind: RunEventKind.Done, ok: false, text: "stopped" });
      void hooks?.end("stopped", "");
      return await finish(run.id, { status: "stopped" });
    }
    const message = errorMessage(error);
    console.error(`[run] ${task.name}: ${message}`);
    onEvent({ kind: RunEventKind.Done, ok: false, text: message });
    void hooks?.end("error", "");
    return await finish(run.id, { status: "error", error: message });
  } finally {
    inFlight.delete(task.id);
    // The slot is free, so whatever was waiting for one can have it.
    drainSoon();
    // Whatever the endpoint refused this run, the next boot need not be refused it again.
    void persistCapabilities();
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
