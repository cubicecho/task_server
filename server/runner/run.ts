import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { type Run, runs, tasks } from "../db/schema.ts";
import { runAgent } from "./agent.ts";
import { loadSettings } from "./llm.ts";

/** Tasks already in flight, so a slow task cannot be started on top of itself. */
const inFlight = new Set<string>();

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

  inFlight.add(taskId);
  try {
    const config = await loadSettings();
    const result = await runAgent({
      config,
      model: task.model || config.model,
      systemPrompt: task.systemPrompt || config.systemPrompt,
      prompt: task.prompt,
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
