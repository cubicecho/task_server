import { argsToZodShape, createHttpHandler } from "@cubicecho/graphql-mcp";
import express from "express";
import type { GraphQLArgument, GraphQLInputFieldConfigMap, GraphQLInputType } from "graphql";
import {
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  getNamedType,
  isInputObjectType,
} from "graphql";
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
    "What happened when tasks ran — `status` is `running`, `ok`, `error` or `stopped`, and a " +
    "finished run carries its output, its error, the tools it called and what it cost. Order " +
    "by `startedAt` descending for the latest; filter by `taskId` for one task's history.",
  steps:
    "What a task does after its own prompt: a flat list of the steps of its flow. `parentId` " +
    "and `branch` say which decision's arm a step sits in — both empty for the task's own " +
    "top-level sequence — and `position` orders it among its siblings. Filter by `taskId`.",
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
    "`decision` picks one of its own `cases` and only that arm's `branches` run, nested as " +
    "deep as you like. Read the current flow with `steps` first and send existing ids back to " +
    "edit in place. An empty list leaves the task with just its prompt.",
  create_trigger:
    "Starts a task on something: `kind: cron` with a five-field expression such as " +
    "`0 9 * * *`, and a `timezone` if it should not follow the server's; or `kind: event` " +
    "with an `event` id, which then fires whenever a `POST` reaches `/webhooks/<that id>`.",
  delete_trigger_single: "Unschedules a task without deleting the task itself.",
};

/**
 * Drops the relation filters from a `where` argument before it becomes a tool's input schema.
 *
 * The generated `TaskFilters` can filter a task by its triggers, its steps and its runs, and each
 * of those filters by its own relations back — `RunFilters.task` is a `TaskFilters`. In GraphQL
 * that costs nothing, because the SDL names a type it has already defined. Rendered as the JSON
 * Schema a tool advertises it has to be written out, and mutual recursion between four tables
 * expands into something enormous: the `tasks` tool alone was 2.8 MB, and the seventeen together
 * were about 18 MB — call it four and a half million tokens of tool definitions, which is more
 * than any model will read. It is the whole listing, so it lands before a client can call
 * anything.
 *
 * Self-reference is not the problem: `OR`, `AND` and `NOT` are the same type as their parent, and
 * zod emits those as a `$ref` costing a couple of hundred bytes. It is the recursion *between*
 * types, which is rebuilt structurally at every level and so cannot be deduplicated.
 *
 * So the relations come out and the columns stay. `where: { enabled: { eq: true } }` is what an
 * agent actually reaches for; "tasks having a run whose step failed" is not worth what it costs
 * here, and is still one `runs` call away. `/graphql` keeps all of it — this prunes a copy of the
 * types, made for the tools, and never the schema the web app is served from.
 */
const pruned = new Map<string, GraphQLInputObjectType>();

/**
 * A field that reaches another table, as opposed to one that constrains a column.
 *
 * Two shapes say so: the list form is its own `…ListRelationFilter` of `some`/`none`/`every`, and
 * the to-one form is simply that table's `…Filters`. The parent's own name is excluded because
 * that is `OR`/`AND`/`NOT`, which cost nothing and are worth keeping.
 */
const isRelationFilter = (named: unknown, parent: GraphQLInputObjectType) =>
  isInputObjectType(named) &&
  (named.name.endsWith("ListRelationFilter") ||
    (named.name.endsWith("Filters") && named.name !== parent.name));

function pruneFilters(type: GraphQLInputObjectType): GraphQLInputObjectType {
  const cached = pruned.get(type.name);
  if (cached) return cached;

  // Registered before the fields are built, because they are a thunk that reads it back: `OR` on
  // the pruned type has to point at the pruned type, not at the original it was copied from.
  const copy: GraphQLInputObjectType = new GraphQLInputObjectType({
    name: type.name,
    description: type.description,
    fields: () => {
      const fields: GraphQLInputFieldConfigMap = {};
      for (const field of Object.values(type.getFields())) {
        if (isRelationFilter(getNamedType(field.type), type)) continue;
        fields[field.name] = {
          description: field.description,
          type: rewireSelf(field.type, type, copy),
        };
      }
      return fields;
    },
  });
  pruned.set(type.name, copy);
  return copy;
}

/** Swaps the parent type for its pruned copy, keeping any list and non-null wrappers around it. */
function rewireSelf(
  type: GraphQLInputType,
  parent: GraphQLInputObjectType,
  copy: GraphQLInputObjectType,
): GraphQLInputType {
  if (type instanceof GraphQLNonNull) {
    return new GraphQLNonNull(rewireSelf(type.ofType, parent, copy));
  }
  if (type instanceof GraphQLList) return new GraphQLList(rewireSelf(type.ofType, parent, copy));
  return isInputObjectType(type) && type.name === parent.name ? copy : type;
}

/** The field's arguments with every `…Filters` among them replaced by its pruned copy. */
const prunedArgs = (args: readonly GraphQLArgument[]) =>
  args.map((arg) => {
    const named = getNamedType(arg.type);
    if (!isInputObjectType(named) || !named.name.endsWith("Filters")) return arg;
    return { ...arg, type: rewireSelf(arg.type, named, pruneFilters(named)) };
  });

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
  decorate: (descriptor, field) => ({
    description: HINTS[descriptor.name]
      ? `${HINTS[descriptor.name]}\n\n${descriptor.description}`
      : descriptor.description,
    inputSchema: argsToZodShape(prunedArgs(field.args)),
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
