import type { Column } from "drizzle-orm";
import type { schema } from "../db/schema.ts";

/**
 * What every generated field means, written once.
 *
 * This prose used to be written twice and reach nobody twice over. It was JSDoc on the column
 * in `db/schema.ts`, which is compile-time only — an agent reading a tool schema on `/mcp` never
 * saw a word of it — and it was a `hint` string typed out again in the form that renders the
 * column, which no agent sees either and which had already drifted from the comment it was
 * copied from. Two copies, each invisible to the other's reader.
 *
 * So it lives here instead, and `describeColumn` below puts it on the schema. From there it is
 * read three ways off the one string: in the SDL, in the JSON Schema of every `/mcp` tool that
 * touches the column, and — through `@cubicecho/graphql-codegen-field-descriptions`, which emits
 * the same descriptions as a runtime map — as the note under the field in the web app.
 *
 * Write for all three. The reader is a person filling in the form *and* a model deciding what to
 * put in an argument, which mostly means the same sentence: what the value does, what an empty
 * one falls back to, and what it is not. Keep it short — a column's description is repeated at
 * every position the column generates (the object type, the create and update inputs, the filter,
 * the aggregates), so a paragraph here is a paragraph five times over in a tool listing that
 * `tests/mcp-endpoint.test.ts` holds to a budget. The rationale that explains why a column exists
 * at all is not this; that stays as commentary in `db/schema.ts` where it can run as long as it
 * needs to.
 */

type Tables = typeof schema;

/** Keyed off the tables themselves, so a renamed column is a typecheck error, not stale prose. */
type ColumnDocs = {
  [T in keyof Tables]?: { [C in keyof Tables[T]["_"]["columns"]]?: string };
};

export const TABLE_DOCS: Partial<Record<keyof Tables, string>> = {
  tasks: "A prompt to run, on a schedule or on a webhook. The unit everything else hangs off.",
  triggers: "What starts a task: a cron expression, or a webhook id.",
  steps:
    "What runs after the task's own prompt. A tree rather than a list, because a `decision` " +
    "step picks which of its arms runs next.",
  runs: "One execution of a task, with what it produced and what it cost.",
  runSteps: "One step of one run: the path a run actually took through the task's tree.",
  mcpServers: "An MCP server this one dials, and the tools it lends to every run.",
  settings: "The one row of server-wide defaults. Every task falls back to what is here.",
};

export const COLUMN_DOCS: ColumnDocs = {
  tasks: {
    name: "What this task is called, in the task list and the run history.",
    prompt: "What the agent is asked to do, each time this task fires.",
    model: "Empty falls back to the default model in settings.",
    systemPrompt: "Empty falls back to the default system prompt in settings.",
    enabled: "A disabled task is never started by a trigger, and can still be run by hand.",
  },

  triggers: {
    taskId: "The task this starts.",
    kind: "`cron` fires on a schedule. `event` fires when `POST /webhooks/<event>` arrives.",
    cron: 'Cron expression, for `kind: "cron"`.',
    timezone: "IANA zone the expression is read in. Empty means the server's own zone.",
    event:
      'The webhook id, for `kind: "event"`: `POST /webhooks/<this>` runs the task. It is the ' +
      "whole of the address — there is no secret — so pick something unguessable.",
    enabled: "A disabled trigger stays on the task and never fires.",
  },

  steps: {
    taskId: "The task whose flow this step belongs to.",
    parentId: "The decision this step hangs off. Null means the task's own top-level sequence.",
    branch: "Which arm of the parent decision this sits in. Empty at the top level.",
    position: "Where in its sequence this step runs, from 0.",
    kind: "`agent` does the work. `decision` does the work *and* picks the arm to run next.",
    name: "What this step is called, in the run history and in `{{steps.<name>}}`.",
    prompt: "What this step asks for. `{{steps.<name>}}` interpolates an earlier step's output.",
    cases: "Decision only: the arms it may choose between. `default` is always available.",
    model: "Empty falls back to the task's model, then to settings.",
    systemPrompt: "Empty falls back to the task's system prompt, then to settings.",
    context: "How much of the run so far this step is shown before its own prompt.",
    enabled: "A disabled step is passed over, and leaves a `skipped` row in the run.",
  },

  runs: {
    taskId: "The task that was run.",
    triggerId: "The trigger that started it. Null for a run started by hand.",
    status:
      "`stopped` is a run called off by hand — not a failure, and not a result. `skipped` is a " +
      "trigger that fired at a task already running: nothing executed, and the reason is in " +
      "`error`. `queued` is a firing waiting for a free slot — it has not run yet and will, in " +
      "this same row.",
    payload:
      "What the trigger handed the run: a webhook's parsed body, and null for everything else. " +
      "It is what `{{event}}` interpolated into the prompt.",
    blockedBy: "`skipped` only: the run that was in the way.",
    attempts:
      "How many firings this row accounts for. One for a run; more for a skip that the same " +
      "trigger walked into repeatedly while the same run held the task, or for a queued run " +
      "that stands for several firings and will run once, with the newest payload.",
    output: "The agent's final reply.",
    error: "Why it failed, or — on a `skipped` run — why it never started.",
    toolCalls: "Every tool the run called, in order, as JSON.",
  },

  runSteps: {
    runId: "The run this step belongs to.",
    stepId: "Null once the step it came from has been edited away; the run's account stands.",
    position: "Execution order within the run, from 0.",
    depth: "How deep in the tree this ran, so the history can be indented the way the task is.",
    name: "The step's name when it ran; the step itself may since have been renamed or deleted.",
    status: "`skipped` is a disabled step, which is neither a success nor a failure.",
    branch: "Decision only: the arm it took.",
    output: "What this step produced, and what later steps interpolate.",
    error: "Why this step failed.",
    toolCalls: "Every tool this step called, in order, as JSON.",
  },

  mcpServers: {
    slug: "Namespace for this server's tools: the agent sees `<slug>__<tool name>`.",
    label: "Shown in the UI instead of the slug. Empty falls back to the slug.",
    enabled: "A disabled server is not dialled, and lends no tools to a run.",
    transport: "`stdio` spawns a local command. `http` dials a URL.",
    command: "The command to spawn, for `stdio`.",
    args: "Arguments for the command, as a JSON array of strings.",
    env:
      "Environment for the spawned command, as a JSON object. Merged over this server's own " +
      "environment, so the child still inherits `PATH`. Credentials live here.",
    url: "The endpoint to dial, for `http`.",
    headers: "Headers sent with every request, as a JSON object. Credentials live here.",
  },

  settings: {
    baseUrl:
      "Any OpenAI-compatible endpoint: Ollama `:11434/v1`, LM Studio `:1234/v1`, OpenAI, " +
      "OpenRouter, vLLM.",
    model: "The model a task uses unless it names one of its own.",
    systemPrompt: "What every run is told before its prompt, unless the task overrides it.",
    maxTokens: "Ceiling on one reply.",
    temperature: "Sampling temperature passed to the model.",
    maxToolIterations:
      "Ceiling on tool round-trips in one run, so a stuck task cannot loop forever.",
    toolDiscovery:
      "`eager` sends every MCP tool definition on every request. `ondemand` sends a name-only " +
      "catalogue and lets the model load the schemas it needs — far cheaper with many tools, at " +
      "the cost of a round trip on the runs that use them.",
    toolSelectModel:
      "Small model that guesses a run's tools before it starts, so on-demand loading usually " +
      "costs no round trip. Empty uses the task's model. Unused unless discovery is on demand.",
    runRetentionDays:
      "How long a finished run is kept, in days. Older runs are deleted hourly. Zero keeps every " +
      "run forever.",
    requestTimeoutSeconds:
      "Seconds of *silence* from the endpoint before a request is given up on. The clock resets " +
      "on every chunk, so a long answer is never cut off. Zero waits forever.",
    maxRetries:
      "How many times a request that failed *before producing anything* is tried again. Only " +
      "that case is safe to retry. Zero turns retries off.",
    maxConcurrentRuns:
      "How many runs may be in flight at once, across every task. A trigger that fires with no " +
      "slot free leaves a `queued` run, which starts when one comes back; a person or an agent " +
      "asking for a run is refused on the spot instead. Zero lifts the limit.",
  },
};

// The hooks take the Drizzle schema keys as plain strings, so the lookup is widened once here
// rather than at each call. The map above is what is typed; this is only how it is read.
const columns: Record<string, Record<string, string | undefined> | undefined> = COLUMN_DOCS;
const tables: Record<string, string | undefined> = TABLE_DOCS;

/** Passed to `buildSchema`. Reaches the column everywhere it becomes a field. */
export const describeColumn = (_column: Column, info: { tableName: string; columnName: string }) =>
  columns[info.tableName]?.[info.columnName];

/** Passed to `buildSchema`. Describes the table's object type. */
export const describeTable = (tableName: string) => tables[tableName];
