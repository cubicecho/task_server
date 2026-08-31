import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { type Run, runs, tasks } from "../db/schema.ts";
import { runAgent } from "./agent.ts";
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
 */
export async function runTask(taskId: string, triggerId?: string): Promise<Run> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error(`no task with id ${taskId}`);
  if (inFlight.has(taskId)) throw new Error(`task "${task.name}" is already running`);

  const [run] = await db
    .insert(runs)
    .values({ taskId, triggerId: triggerId ?? null, status: "running" })
    .returning();

  const controller = new AbortController();
  inFlight.set(taskId, { runId: run.id, controller });
  try {
    const config = await loadSettings();
    const result = await runAgent({
      config,
      model: task.model || config.model,
      systemPrompt: task.systemPrompt || config.systemPrompt,
      prompt: task.prompt,
      signal: controller.signal,
    });
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
      return await finish(run.id, { status: "stopped" });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[run] ${task.name}: ${message}`);
    return await finish(run.id, { status: "error", error: message });
  } finally {
    inFlight.delete(taskId);
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
