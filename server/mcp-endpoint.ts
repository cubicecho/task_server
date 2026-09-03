import { applyNameCase, createHttpHandler } from "@cubicecho/graphql-mcp";
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
  // Every arm that met this surface needed a task it knew only by name, and the `id` example was
  // the only filter it had been shown. Each one guessed `name: { eq: … }` and each one was right,
  // which is the kind of luck a description should not be relying on.
  tasks:
    "Every task on this server: its prompt, the model it runs on, and whether it is enabled. " +
    "Any column filters the same way — `where: { id: { eq: … } }` for one you have the id of, " +
    '`where: { name: { eq: "nightly digest" } }` for one you know by name. A text column takes ' +
    "`eq`, `ne`, `contains`, `startsWith`, `endsWith` and their case-insensitive twins " +
    "`iContains`, `iStartsWith`, `iEndsWith` — spelled in camelCase, not `icontains` — plus " +
    "`inArray`, `isNull`, and `AND`/`OR`/`NOT` for combining them.\n\n" +
    "`enabled: false` on the task is the switch that dominates: it fires from nothing, and its " +
    "triggers go on reading `enabled: true` while it does. `schedule` is where the effective " +
    "answer lives — for a `cron` trigger. An `event` trigger never appears there, armed or " +
    "not, so its two `enabled` flags are the whole of what can be read back about it.",
  runs:
    "What happened when tasks ran — `status` is `running`, `ok`, `error`, `stopped` or " +
    "`skipped`, and a finished run carries its output, its error, the tools it called and what " +
    "it cost. A `skipped` run never started: its trigger fired while the run named by " +
    "`blockedBy` still held the task, and `attempts` counts how many firings it stands for. " +
    "Such a row spans its whole collision — `startedAt` is the first firing it stands for and " +
    "`finishedAt` moves with the most recent — so its timestamps are a window rather than a " +
    "duration, and it can outlast the run that blocked it.\n\n" +
    "Filter by `taskId` for one task's history, and order by " +
    "`{ startedAt: { direction: desc, priority: 1 } }` for the latest — every generated " +
    "`orderBy` takes that shape, and `priority` is required rather than defaulted. Where a " +
    "`skipped` row has `attempts` above 1, read `finishedAt` too: that row stays where its " +
    "first firing put it while absorbing newer ones, so the top of this ordering is not always " +
    "the newest event.",
  // Ordering is spelled out here as well as under `runs`, because a flow read in the wrong order
  // is not an error — it is a tree reassembled wrongly, and the caller has no way to notice.
  steps:
    "What a task does after its own prompt: a flat list of the steps of its flow. `parentId` " +
    "and `branch` say which decision's arm a step sits in — both empty for the task's own " +
    "top-level sequence — and `position` orders it among its siblings. Filter by `taskId`. " +
    "This is the reading shape only; `set_task_steps` takes the same tree nested, and these " +
    "rows cannot be handed back to it as they stand. Order by " +
    "`{ position: { direction: asc, priority: 1 } }`; `priority` is required.",
  run_steps:
    "The path one run actually took, a row per step it executed, in `position` order. On a " +
    "decision, `branch` is the arm it chose — which is the thing you open a run to find out. " +
    "Filter by `runId`.",
  triggers:
    "What makes tasks fire: a `cron` trigger carries an expression read in its own timezone, " +
    "an `event` trigger carries the id it answers to at `POST /webhooks/<event>`.\n\n" +
    "A trigger's own `enabled` is not the whole story — one on a disabled task still reads " +
    "`enabled: true` and still never fires. Read `schedule` for what is actually armed, " +
    "remembering that it covers `cron` only: an `event` trigger is absent from it either way.",
  create_task:
    "Adds a task. It will not fire on its own until it has a trigger — add one with " +
    "`create_trigger`, or call `run_task` to run it now.",
  update_task:
    "Edits one task. `set: { enabled: false }` keeps a task but stops it firing, which is the " +
    "gentler alternative to deleting it.",
  delete_task:
    "Deletes one task, its triggers and its history. Refused while the task is running: stop " +
    "it first with `stop_task`.",
  // The generated description below already says that a flow is written whole and that ids sent
  // back are kept, so this says neither. What it does keep is the warning, because the failure
  // it describes is silent: an agent that loses a decision's arms gets no error to learn from.
  set_task_steps:
    "Gives a task the steps that run after its own prompt, replacing whatever it had. A step " +
    "is `kind: agent` — one prompt, run as a turn, and the default when you send no `kind` — " +
    "or `kind: decision`; there is no third. Every step needs a `prompt`, a decision " +
    "included.\n\n" +
    "Steps " +
    "run in order and each one sees what the ones before it produced; a step of kind " +
    "`decision` picks one of its own `cases`, and what runs next is that arm's entry in " +
    '`branches` — `{ case: "yes", steps: [ … ] }` — nested as deep as you like.\n\n' +
    "Read back, the same flow is flat: `parentId` and `branch` describe the tree and are not " +
    "fields you can send. A client that strips them rather than failing sends every step at " +
    "the top level, where a decision keeps its `cases` and silently loses the arms under " +
    "them — so build the nesting yourself.\n\n" +
    "A `case` with no steps stores nothing, so an arm you sent empty and an arm you never " +
    "mentioned read back the same. The arm is named either way by the decision's `cases`; " +
    "there is nothing to check afterwards, and nothing has gone wrong.",
  create_trigger:
    "Starts a task on something: `kind: cron` with a five-field expression such as " +
    "`0 9 * * *`, and a `timezone` if it should not follow the server's; or `kind: event` " +
    "with an `event` id, which then fires whenever a `POST` reaches `/webhooks/<that id>`.",
  update_trigger:
    "Edits one trigger — retime a `cron`, move it to another `timezone`, or repoint an " +
    "`event` at a different webhook id. `set: { enabled: false }` disarms the trigger while " +
    "leaving the task alone, which is the one to reach for when a task has several triggers " +
    "and only one of them should stop.",
  delete_trigger: "Unschedules a task without deleting the task itself.",
};

/**
 * The tool name for every root field that becomes one, so prose can name a neighbour and be
 * right on both surfaces.
 *
 * A description is written once and read twice. `schema.graphql` calls the field `runEvents`
 * and an MCP client calls the tool `run_events`, and a cross-reference spelled for one surface
 * is a name the other cannot find — an agent told to "read `runEvents`" has no such tool and
 * nothing to match it against. Rewriting is better than picking one spelling by hand, which is
 * a thing to remember every time a description mentions another field.
 *
 * Only names that are actually tools here are touched, so a result field keeps its own
 * spelling: `startedAt` and `blockedBy` are columns an agent will read back in JSON, not tools.
 */
const TOOL_NAMES = new Map(
  TOOLS.map((path) => {
    const field = path.slice(path.indexOf(".") + 1);
    return [field, toolNameFor(field)];
  }),
);

/**
 * The tool name for a root field, and the one place that spelling is decided.
 *
 * drizzle-graphql calls the single-row update `updateTaskSingle`, and the qualifier is there to
 * keep it apart from the bulk `updateTask` — which this surface does not expose at all. So the
 * name distinguishes a tool from one an agent cannot see, and every arm that met it read it as
 * a variant to pick between rather than as the update. `Single` comes off here.
 *
 * The rename belongs at this layer rather than in `buildSchema`: the web app has both forms and
 * needs to tell them apart, so the schema keeps the qualifier and only the agent loses it. It
 * could not be done there in any case — `suffixes.single` renames the single *insert* and is
 * ignored by update and delete.
 *
 * `TOOL_NAMES` and the driver's `toolName` both come through here, so a name written in prose
 * and the tool it names cannot drift apart.
 */
function toolNameFor(field: string): string {
  const base = field.endsWith("Single") ? field.slice(0, -"Single".length) : field;
  // The driver's own casing rather than a hand-rolled one. They agree on every name here and
  // would keep agreeing until a field split an acronym — `parseURLFilter` is the example the
  // package gives — and a tool the prose names by a spelling the listing does not use is the
  // failure this whole function exists to prevent.
  return applyNameCase(base);
}

/** Where the driver's generated footer starts — everything above it is prose. */
const FOOTER = /\n\nGraphQL (query|mutation): /;

/**
 * Respells backticked root-field names as tool names, in the prose only.
 *
 * The footer under it says "GraphQL mutation: `runTask` → `Run!`", which is a claim about the
 * schema rather than about the tool surface, and stays true by staying untouched.
 */
function useToolNames(description: string): string {
  const cut = description.search(FOOTER);
  const prose = cut === -1 ? description : description.slice(0, cut);
  const footer = cut === -1 ? "" : description.slice(cut);
  const renamed = prose.replace(/`(\w+)`/g, (match, name) => {
    const tool = TOOL_NAMES.get(name);
    return tool ? `\`${tool}\`` : match;
  });
  return renamed + footer;
}

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
  // `include` names GraphQL fields and this names tools, so the two are spelled differently on
  // purpose — `Mutation.updateTaskSingle` above becomes `update_task` here.
  toolName: (field) => toolNameFor(field.name),
  // One level: the leaf fields of what a tool returns. Two would pull every run — output and
  // all — into a listing of tasks, which is a lot of context for a question about names.
  selectionDepth: 1,
  mutationHints: "byName",
  // Keeps the explicit `null` branch on the write payloads and drops it everywhere else.
  // Dropping it everywhere was tried and reverted: on a mutation input the branch is not only
  // how a caller clears a column, it is how a model says "this optional is absent" — writing
  // `"cases": null` beside the fields it did fill in is the ordinary thing to do, and it became
  // a validation error. On a `where`, an `orderBy` or a `having` there is nothing an explicit
  // null means: absent is the whole of it, and the branch is bytes an agent reads past.
  //
  // Still keyed on the root field's kind, and not on the type. 2.10.0 added `{ byType }` for the
  // narrower rule this wants — a filter never legitimately takes an explicit null, wherever it
  // appears — but it resolves at each *position's* own named type, and a filter's bytes are in
  // its leaves: `StringFilter.eq` is a `String`, and so is `CreateTaskInput.model`. One name,
  // two answers needed. Keyed that way the write payloads lose their null branches with the
  // filters, which is the regression above, so the per-kind split is what is expressible here.
  nullBranches: (_field, kind) => (kind === "query" ? "never" : "always"),
  // Relation filters are the closure that made this listing 92% machinery: `TaskFilters` takes
  // `triggers`/`steps`/`runs` as list-relation filters, each pulling in the other table's whole
  // filter type, which carries its own relation fields back. Pruning the three fields — nothing
  // else — halves the surface, and across 100 logged calls on it no agent sent one. An agent
  // that wants a task's triggers reads `list_triggers` and looks at `taskId`, which is the
  // question it was going to ask anyway.
  //
  // This prunes the *projection*: `schema` is the same object yoga serves the web app from, and
  // it keeps every one of them. That is the whole reason the knob is here rather than in
  // `buildSchema` — the schema is right, and it was only this surface that was over-broad.
  inputField: (field) => !String(field.type).includes("ListRelationFilter"),
  decorate: (descriptor) => ({
    description: useToolNames(
      HINTS[descriptor.name]
        ? `${HINTS[descriptor.name]}\n\n${descriptor.description}`
        : descriptor.description,
    ),
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
