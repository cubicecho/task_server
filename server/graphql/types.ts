/**
 * The GraphQL types with no table behind them.
 *
 * The CRUD half of the API is generated from the Drizzle schema, so a type there follows its
 * table by construction. These follow nothing: a live MCP connection, the scheduler's next
 * firing, a run event held in memory for a minute, a flow as the tree the editor holds rather
 * than the rows it is stored as. They are declared apart from `schema.ts` because changing a
 * shape and wiring up the field that returns it are different edits, and one file doing both
 * meant neither was easy to find.
 *
 * Every `description` here is read twice — once as SDL, and once by an agent on `/mcp` deciding
 * whether this is the field it wants.
 */

import { GraphQLDateTime } from "@vantreeseba/drizzle-graphql";
import {
  GraphQLBoolean,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";
import { GraphQLJSON } from "graphql-scalars";

const McpToolType = new GraphQLObjectType({
  name: "McpTool",
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: new GraphQLNonNull(GraphQLString) },
  },
});

export const McpServerStatusType = new GraphQLObjectType({
  name: "McpServerStatus",
  description: "Live connection state for a configured MCP server, and the tools it offers.",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    slug: { type: new GraphQLNonNull(GraphQLString) },
    label: { type: new GraphQLNonNull(GraphQLString) },
    status: { type: new GraphQLNonNull(GraphQLString) },
    error: { type: new GraphQLNonNull(GraphQLString) },
    tools: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(McpToolType))) },
  },
});

export const McpConnectionInput = new GraphQLInputObjectType({
  name: "McpConnectionInput",
  description: "How to reach an MCP server — the connection half of a row, without its identity.",
  fields: {
    transport: { type: new GraphQLNonNull(GraphQLString) },
    command: { type: GraphQLString },
    args: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
    env: { type: GraphQLJSON },
    url: { type: GraphQLString },
    headers: { type: GraphQLJSON },
  },
});

export const McpProbeType = new GraphQLObjectType({
  name: "McpProbe",
  description: "The result of dialling an MCP server once, without saving or pooling it.",
  fields: {
    ok: { type: new GraphQLNonNull(GraphQLBoolean) },
    error: { type: new GraphQLNonNull(GraphQLString) },
    tools: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(McpToolType))) },
  },
});

export const ScheduleEntryType = new GraphQLObjectType({
  name: "ScheduleEntry",
  description: "A cron trigger that is currently armed, and when it next fires.",
  fields: {
    triggerId: { type: new GraphQLNonNull(GraphQLString) },
    taskId: { type: new GraphQLNonNull(GraphQLString) },
    cron: { type: new GraphQLNonNull(GraphQLString) },
    nextRun: { type: GraphQLString },
  },
});

/**
 * A flow, as the editor holds it: steps nested inside the branches of the decisions above them.
 *
 * Recursive input objects are legal GraphQL, and this shape is the tree itself rather than the
 * flattened rows — so a client never has to compute a `parentId`, a `branch` or a `position`,
 * and cannot get one wrong.
 */
const StepBranchInputType: GraphQLInputObjectType = new GraphQLInputObjectType({
  name: "StepBranchInput",
  description: "One arm of a decision: the case it answers to, and what runs if it does.",
  fields: () => ({
    case: {
      type: new GraphQLNonNull(GraphQLString),
      description: 'One of the decision\'s own cases, or "default" for the fall-through arm.',
    },
    steps: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(StepInputType))) },
  }),
});

export const StepInputType: GraphQLInputObjectType = new GraphQLInputObjectType({
  name: "StepInput",
  description: "A step of a task's flow, with whatever hangs off it.",
  fields: () => ({
    id: {
      type: GraphQLString,
      description:
        "Send back the id of an existing step to edit it in place, so the run history that " +
        "points at it stays pointed at it. Omit for a new step.",
    },
    kind: { type: GraphQLString, description: "agent (default) | decision." },
    name: {
      type: GraphQLString,
      description: "What this step is called, in the run history and in `{{steps.<name>}}`.",
    },
    prompt: {
      type: new GraphQLNonNull(GraphQLString),
      description:
        "What this step is asked to do. Required on a `decision` too, and for the same reason: " +
        "a decision is a full agent run — reading the mail, checking the build — that has to " +
        "end on one of its `cases`. The prompt is the work it does to decide, and `cases` is " +
        "only the shape of the answer, so a decision with no prompt has nothing to go on.",
    },
    cases: {
      type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
      description: "Decision only, and required for one: the arms it may choose between.",
    },
    model: { type: GraphQLString, description: "Empty falls back to the task's, then Settings'." },
    systemPrompt: { type: GraphQLString },
    context: {
      type: GraphQLString,
      description:
        "How much of the run so far this step is shown before its own prompt: all (default) | " +
        "previous | none. Ignored where the prompt places `{{previous}}` or `{{steps.<name>}}` " +
        "itself.",
    },
    enabled: { type: GraphQLBoolean },
    branches: {
      type: new GraphQLList(new GraphQLNonNull(StepBranchInputType)),
      description: "Decision only: what runs under each case.",
    },
  }),
});

export const RunEventType = new GraphQLObjectType({
  name: "RunEvent",
  description:
    "Something a run did while it was running — a token, a tool call, a step boundary. Held in " +
    "memory for the length of the run and a minute after; the run row is the lasting record.",
  fields: {
    runId: { type: new GraphQLNonNull(GraphQLString) },
    seq: {
      type: new GraphQLNonNull(GraphQLInt),
      description: "Per-run counter from 1, so a client can order and de-duplicate.",
    },
    at: { type: new GraphQLNonNull(GraphQLDateTime) },
    kind: {
      type: new GraphQLNonNull(GraphQLString),
      description:
        "step | decision | turn | thinking | output | tool-call | tool-result | notice | done.",
    },
    text: { type: new GraphQLNonNull(GraphQLString) },
    name: {
      type: new GraphQLNonNull(GraphQLString),
      description: "Tool name, where there is one.",
    },
    step: {
      type: new GraphQLNonNull(GraphQLString),
      description:
        "The flow step this happened inside, so a watcher can group a run the way the task is " +
        "written. Empty for what belongs to the run rather than to any one step.",
    },
    ok: { type: GraphQLBoolean },
  },
});
