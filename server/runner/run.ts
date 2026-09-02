import { eq } from "drizzle-orm";
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
): Promise<{ run: Run; done: Promise<Run> }> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error(`no task with id ${taskId}`);
  if (inFlight.has(taskId)) throw new Error(`task "${task.name}" is already running`);
  // Read once, before the run starts: a flow edited halfway through would make the run's own
  // account of itself untrue.
  const flow = await db.select().from(steps).where(eq(steps.taskId, taskId));

  const [run] = await db
    .insert(runs)
    .values({ taskId, triggerId: triggerId ?? null, status: "running" })
    .returning();

  const controller = new AbortController();
  inFlight.set(taskId, { runId: run.id, controller });
  return { run, done: execute({ run, task, flow, controller }) };
}

/** The run itself, once `startTask` has decided there is going to be one. */
async function execute({
  run,
  task,
  flow,
  controller,
}: {
  run: Run;
  task: typeof tasks.$inferSelect;
  flow: (typeof steps.$inferSelect)[];
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
