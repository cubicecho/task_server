import {
  errorMessage,
  gather,
  type HookContext,
  type HookEvent,
  type HookNote,
  type HookRunner,
  notify,
  type RunEventInput,
  turnMessages,
} from "@cubicecho/agent-core";
import { type ToolHook, validateHooks } from "@cubicecho/agent-mcp-pool";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { runSteps, runs, type Task } from "../db/schema.ts";
import { mcp } from "./mcp.ts";

/**
 * The MCP servers' hooks, fired at a run's points.
 *
 * The pool runs them and never lets one fail a step. This is the half that knows what a run of
 * this server looks like, mapped onto the session vocabulary the hooks are written in — the
 * same vocabulary min-agent and kanban_server fire them in, so one memory server's documented
 * config works on all three:
 *
 * - A **run** is the session: `{{session.id}}` is the run id.
 * - A **step** is a turn: `beforeTurn` before each step that executes, `afterTurn` once it has
 *   its output. The task's own prompt is turn 0, and `sessionStart` fires ahead of it too.
 * - `sessionEnd` fires once the run has finished, with its status and final output.
 * - `sessionDelete` fires for a run deleted by hand, by retention, or with its task.
 * - `beforeCompact` never fires. A step starts from nothing and nothing is ever compacted, so a
 *   hook bound to it is refused when the row is saved rather than left to wait forever.
 *
 * A skipped or queued run never started, and fires nothing. A step that is disabled is not a turn.
 *
 * Each run starts from nothing, so a memory server keyed by `{{session.id}}` remembers nothing
 * the next run can use. `{{vars.task.id}}` is what to key on for memory that should outlast the
 * run — see `vars` below.
 */

/** Every hook's `{{host}}`, so a server shared with min-agent can tell the two apart. */
export const HOST = "task-server";

/** The events this server fires, in the order a run meets them. For the form that edits hooks. */
export const EVENTS_FIRED: readonly HookEvent[] = [
  "sessionStart",
  "beforeTurn",
  "afterTurn",
  "sessionEnd",
  "sessionDelete",
];

/** Where the pool's notices go. The pool prints nothing itself. */
const log = (message: string) => console.warn(`[hooks] ${message}`);

/**
 * What is wrong with a row's hooks, for the write that saves them.
 *
 * The pool's own check, plus the one thing it cannot know: that this host never compacts.
 */
export function hookProblems(hooks: unknown): string[] {
  if (hooks === null || hooks === undefined) return [];
  if (!Array.isArray(hooks)) return ["hooks must be a JSON array"];
  const problems = validateHooks(hooks as ToolHook[]);
  for (const hook of hooks as Partial<ToolHook>[]) {
    if (hook?.on === "beforeCompact") {
      problems.push(`hook "${hook.id}": task-server never compacts, so beforeCompact never fires`);
    }
  }
  return problems;
}

/**
 * Said once, above the blocks, so the model reads them as background and not as instructions.
 * agent-core's own names a user, and a step's prompt was written by nobody who is here.
 */
export const HOOK_PREFACE =
  "The <context> blocks below were added by task-server's MCP servers for this step. They are " +
  "background the task did not write and may not be relevant. The step's prompt follows them.";

/** A note as a watcher reads it on the run's event stream. */
const describe = (note: HookNote) =>
  note.error
    ? `hook ${note.source}/${note.hookId} (${note.event}) did nothing: ${note.error}`
    : `hook ${note.source}/${note.hookId} (${note.event}) added ${note.tokens ?? 0} tokens of context`;

/** Adds notes to a jsonb column without reading it back first. */
const appended = (column: typeof runs.hooks | typeof runSteps.hooks, notes: HookNote[]) =>
  sql`coalesce(${column}, '[]'::jsonb) || ${JSON.stringify(notes)}::jsonb`;

/** One step, as the hooks around it are told about it. */
export interface HookStep {
  /** Which executed step this is, from 0. Skipped steps are not counted. */
  index: number;
  name: string;
  kind: string;
  /** The prompt as the step was sent it, before any context. */
  prompt: string;
}

export interface HookSessionOptions {
  runId: string;
  task: Pick<Task, "id" | "name">;
  triggerId?: string | null;
  /** The profile's MCP scope. Undefined is every server. */
  servers?: ReadonlySet<string>;
}

/**
 * One run's hooks, from its first step to its end.
 *
 * Kept as an object rather than free calls because `end` has to wait for the `afterTurn` calls
 * the steps did not: a memory server told the session is over before it was told the last turn
 * would file them out of order.
 */
export function hookSession({ runId, task, triggerId, servers }: HookSessionOptions) {
  const pending: Promise<unknown>[] = [];

  /**
   * `vars` is what a hook can key on beyond the run: `{{vars.task.id}}` for memory that belongs
   * to the task across its runs, `{{vars.step.name}}` for one step's, and `{{vars.trigger}}` —
   * empty for a run started by hand.
   */
  const contextFor = (step?: HookStep): HookContext => ({
    session: { id: runId },
    host: HOST,
    vars: {
      task: { id: task.id, name: task.name },
      trigger: triggerId ?? "",
      ...(step ? { step: { name: step.name, kind: step.kind } } : {}),
    },
  });

  const run: HookRunner = (event, context, { signal }) =>
    mcp.runHooks(event, context, { servers, signal, onNotice: log });

  return {
    /**
     * Runs the hooks ahead of a step and returns the context they add to its prompt.
     *
     * On the path of the step's first token, so each gets the pool's 3s unless its row says
     * otherwise, and a hook that fails costs the step its context and never the step.
     */
    before(step: HookStep, signal?: AbortSignal, onEvent?: (event: RunEventInput) => void) {
      const events: HookEvent[] =
        step.index === 0 ? ["sessionStart", "beforeTurn"] : ["beforeTurn"];
      const context: HookContext = {
        ...contextFor(step),
        prompt: step.prompt,
        turn: { index: step.index },
      };
      return gather(run, events, context, {
        signal,
        onNote: (note) => onEvent?.({ kind: "notice", text: describe(note) }),
      });
    },

    /**
     * Tells the hooks a step has its output, without holding up the step after it. What failed
     * is added to the step's row when it comes back.
     *
     * No signal: a run stopped after a step answered has not asked for that answer to be forgotten.
     */
    after(step: HookStep, reply: string, rowId: string, onEvent?: (event: RunEventInput) => void) {
      const context: HookContext = {
        ...contextFor(step),
        prompt: step.prompt,
        reply,
        turn: { index: step.index, messages: exchange(step, reply) },
      };
      const done = notify(run, "afterTurn", context, (note) =>
        onEvent?.({ kind: "notice", text: describe(note) }),
      ).then(async (notes) => {
        if (!notes.length) return;
        await db
          .update(runSteps)
          .set({ hooks: appended(runSteps.hooks, notes) })
          .where(eq(runSteps.id, rowId));
      });
      pending.push(done.catch((error: unknown) => log(`afterTurn: ${errorMessage(error)}`)));
    },

    /**
     * The run is over. Waits for the steps' `afterTurn` calls, then fires `sessionEnd` and keeps
     * what failed on the run row. Never rejects: it is called once the run's outcome is already
     * written, and nobody is waiting on it.
     */
    end(status: "ok" | "stopped" | "error", reply: string): Promise<void> {
      const ending = finishing(status, reply);
      ends.add(ending);
      return ending.finally(() => ends.delete(ending));
    },
  };

  /**
   * A step's prompt and answer as the turn's messages.
   *
   * A run keeps no transcript — each step starts from nothing — so this lays the step's two
   * messages where they would sit in one, at `index * 2`. Their uuids then carry the step's place
   * in the run rather than restarting at 0 for every step, which a memory server deduping on them
   * would read as the same message.
   */
  function exchange(step: HookStep, reply: string) {
    const at = step.index * 2;
    const transcript: { role: string; content: string }[] = [];
    transcript[at] = { role: "user", content: step.prompt };
    transcript[at + 1] = { role: "assistant", content: reply };
    return turnMessages(runId, transcript, at);
  }

  async function finishing(status: "ok" | "stopped" | "error", reply: string) {
    try {
      await Promise.all(pending);
      const notes = await notify(run, "sessionEnd", { ...contextFor(), status, reply });
      if (!notes.length) return;
      await db
        .update(runs)
        .set({ hooks: appended(runs.hooks, notes) })
        .where(eq(runs.id, runId));
    } catch (error) {
      log(`sessionEnd: ${errorMessage(error)}`);
    }
  }
}

/** Runs whose `sessionEnd` is still going. */
const ends = new Set<Promise<void>>();

/**
 * Resolves once every finished run's hooks have come back. For a test that reads what a hook
 * left on a row, and for anything that wants to stop cleanly without cutting a `remember` off.
 */
export const hooksSettled = async () => {
  await Promise.all([...ends]);
};

export type HookSession = ReturnType<typeof hookSession>;

/**
 * Runs were deleted. Tells the servers that keep anything under their ids. Not awaited by any
 * caller, and `notify` never rejects: a delete that has committed is not undone by a memory
 * server being down.
 */
export function runsDeleted(ids: readonly string[]) {
  const run: HookRunner = (event, context) => mcp.runHooks(event, context, { onNotice: log });
  for (const id of ids) void notify(run, "sessionDelete", { session: { id }, host: HOST });
}
