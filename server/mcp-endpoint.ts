import { createHttpHandler } from "@cubicecho/graphql-mcp";
import express from "express";
// The version a client is told it is talking to; without it the wrapper library reports its own.
// Default import, not a named one: Node's own JSON modules only export a default, and the
// container runs this file through Node rather than tsx.
import pkg from "../package.json" with { type: "json" };
import { schema } from "./graphql/schema.ts";

/**
 * The tools an outside client is handed, and nothing else.
 *
 * The schema has forty-odd root fields — aggregates, group-bys, bulk writes, the settings row
 * with the API key behind it — and projecting all of them would spend an agent's context on
 * things no agent should be reaching for. These are the ones that make this a task server to
 * someone driving it from outside: read the tasks, their flows and their runs, watch a run,
 * start or stop one, and write tasks, their flows and their schedules.
 *
 * Left out on purpose: `settings`/`setApiKey` (the server's own credentials are the operator's
 * business, not a visiting agent's), the MCP-server rows (same), and every bulk mutation — a
 * `deleteTask` with no `where` empties the table, and `deleteTaskSingle` cannot.
 */
const TOOLS = [
  "Query.tasks",
  "Query.steps",
  "Query.runs",
  "Query.runSteps",
  "Query.runEvents",
  "Query.triggers",
  "Query.schedule",
  "Query.models",
  "Mutation.createTask",
  "Mutation.updateTaskSingle",
  "Mutation.deleteTaskSingle",
  "Mutation.setTaskSteps",
  "Mutation.createTrigger",
  "Mutation.updateTriggerSingle",
  "Mutation.deleteTriggerSingle",
  "Mutation.runTask",
  "Mutation.stopTask",
];

/**
 * A line of orientation on the tools whose GraphQL fields are generated, and so describe
 * themselves only as "the `tasks` query". A visiting agent has no other way to learn that a
 * task without a trigger never fires, or that a run it just started can be watched.
 *
 * Keyed by tool name, which is the snake_case one the client sees — `decorate` runs after the
 * rename. The `include` list above is not: filtering happens before it, on the GraphQL field.
 */
const HINTS: Record<string, string> = {
  tasks:
    "Every task on this server: its prompt, the model it runs on, and whether it is enabled. " +
    "Filter with `where: { id: { eq: … } }` for one of them.",
  runs:
    "What happened when tasks ran — `status` is `running`, `ok`, `error`, `stopped` or " +
    "`skipped`, and a finished run carries its output, its error, the tools it called and what " +
    "it cost. A `skipped` run never started: its trigger fired while the run named by " +
    "`blockedBy` still held the task, and `attempts` counts how many firings it stands for. " +
    "Order by `startedAt` descending for the latest; filter by `taskId` for one task's history.",
  steps:
    "What a task does after its own prompt: a flat list of the steps of its flow. `parentId` " +
    "and `branch` say which decision's arm a step sits in — both empty for the task's own " +
    "top-level sequence — and `position` orders it among its siblings. Filter by `taskId`. " +
    "This is the reading shape only; `set_task_steps` takes the same tree nested, and these " +
    "rows cannot be handed back to it as they stand.",
  run_steps:
    "The path one run actually took, a row per step it executed, in `position` order. On a " +
    "decision, `branch` is the arm it chose — which is the thing you open a run to find out. " +
    "Filter by `runId`.",
  triggers:
    "What makes tasks fire: a `cron` trigger carries an expression read in its own timezone, " +
    "an `event` trigger carries the id it answers to at `POST /webhooks/<event>`.",
  create_task:
    "Adds a task. It will not fire on its own until it has a trigger — add one with " +
    "`create_trigger`, or call `run_task` to run it now.",
  update_task_single:
    "Edits one task. `set: { enabled: false }` keeps a task but stops it firing, which is the " +
    "gentler alternative to deleting it.",
  delete_task_single:
    "Deletes one task, its triggers and its history. Refused while the task is running: stop " +
    "it first with `stop_task`.",
  set_task_steps:
    "Gives a task the steps that run after its own prompt, replacing whatever it had. Steps " +
    "run in order and each one sees what the ones before it produced; a step of kind " +
    "`decision` picks one of its own `cases`, and what runs next is that arm's entry in " +
    '`branches` — `{ case: "yes", steps: [ … ] }` — nested as deep as you like. An empty ' +
    "list leaves the task with just its prompt.\n\n" +
    "The flow is written nested and read back flat, so a read is not an input. `steps` and " +
    "this tool's own result describe the tree with `parentId` and `branch`, which are not " +
    "fields you can send: handing those rows back is refused, and handing them back with the " +
    "unrecognised keys stripped out is worse — it is accepted, and every step arrives at the " +
    "top level, so a decision keeps its `cases` and silently loses the arms under them. Build " +
    "the nesting yourself, and send each existing step's `id` back inside it so the run " +
    "history stays pointed at it.",
  create_trigger:
    "Starts a task on something: `kind: cron` with a five-field expression such as " +
    "`0 9 * * *`, and a `timezone` if it should not follow the server's; or `kind: event` " +
    "with an `event` id, which then fires whenever a `POST` reaches `/webhooks/<that id>`.",
  delete_trigger_single: "Unschedules a task without deleting the task itself.",
};

/**
 * The two mutations a naming convention cannot classify, and what they actually do.
 *
 * `mutationHints: "byName"` reads the conventional prefixes off the GraphQL field name, which
 * settles seven of the nine: the creates destroy nothing, the deletes do and land the same way
 * twice, and the updates and `set_task_steps` rewrite what they touch. A client that gates on
 * `destructiveHint` — asking the operator before it proceeds — should be spending that
 * interruption on the delete, and it cannot if adding a task looks the same as dropping one.
 *
 * `runTask` and `stopTask` are named after neither prefix, so they arrive under the conservative
 * default of destructive and not idempotent. Only one of them earns it.
 *
 * `run_task` destroys nothing: it adds a run and waits for it. It is not idempotent, though —
 * running a task twice runs it twice — so the default is overridden in one direction only.
 *
 * `stop_task` keeps the destructive mark. Aborting a run discards it: the run is finished as
 * `stopped` with no output, so whatever it had done by then is gone and cannot be resumed, which
 * is worth an operator's confirmation. Calling it a second time is free — nothing is in flight
 * and it answers `false` — and that is the part the convention has no way to know.
 */
const WRITE_HINTS: Record<string, { destructiveHint?: boolean; idempotentHint?: boolean }> = {
  run_task: { destructiveHint: false },
  stop_task: { idempotentHint: true },
};

/**
 * The same schema the web app uses, offered to other clients as MCP tools.
 *
 * A task server whose own API is a set of tools can be driven by an agent — "add a task that
 * checks the build every morning" — which is the shortest path from this being a CRUD app to
 * being something an assistant operates.
 *
 * Stateless: each request builds its own server and answers as JSON, so nothing is pinned to a
 * process and a client can reconnect whenever it likes. Sessions would buy server-initiated
 * messages over an open stream; nothing here sends any.
 */
export const mcpHandler = createHttpHandler({
  schema,
  name: "task-server",
  version: pkg.version,
  include: TOOLS,
  // One level: the leaf fields of what a tool returns. Two would pull every run — output and
  // all — into a listing of tasks, which is a lot of context for a question about names.
  selectionDepth: 1,
  mutationHints: "byName",
  decorate: (descriptor) => ({
    description: HINTS[descriptor.name]
      ? `${HINTS[descriptor.name]}\n\n${descriptor.description}`
      : descriptor.description,
    ...(WRITE_HINTS[descriptor.name] ? { annotations: WRITE_HINTS[descriptor.name] } : {}),
  }),
});

/**
 * Mounts the endpoint. `all`, not `post`: a client does more than call tools — it opens the
 * notification stream with a `GET` and ends its session with a `DELETE` — and the transport
 * answers all three, in JSON-RPC, including when the request is wrong. Mounted on `post`
 * alone, the other two met Express's 404 page instead, which reads as "wrong URL".
 */
export function mountMcp(app: express.Application, route = "/mcp") {
  app.all(route, express.json(), mcpHandler);
}
