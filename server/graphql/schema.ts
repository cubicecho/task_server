import { buildSchema, GraphQLDateTime } from "@vantreeseba/drizzle-graphql";
import {
  GraphQLBoolean,
  GraphQLError,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  type GraphQLOutputType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import { GraphQLJSON } from "graphql-scalars";
import { db } from "../db/client.ts";
import { fold, history, type RunEvent, watch } from "../runner/events.ts";
import { listModels } from "../runner/llm.ts";
import { type McpConnection, mcp, probe } from "../runner/mcp.ts";
import { runningRunIds, runningTaskIds, runTask, stopTask } from "../runner/run.ts";
import { state as scheduleState, syncSoon } from "../scheduler/cron.ts";

/**
 * The CRUD half of the API is generated from the Drizzle schema — tasks, triggers, runs, MCP
 * servers and settings all get their queries, filters and mutations for free, and stay in step
 * with the tables by construction. Only the handful of operations that are *not* row edits are
 * written by hand below.
 */
const { entities } = buildSchema(db, {
  // `tasks` → type `Task`, queries `tasks` (list) and `task` (single).
  typeNameMapper: "singularize",
  // A SQLite timestamp is an integer column under the hood, so built-in detection leaves it
  // as `JSON`. It is a date to everyone who reads it, and `DateTime` transports ISO-8601.
  mapColumnType: (column) =>
    column.columnType === "SQLiteTimestamp" ? GraphQLDateTime : undefined,
  // The run history is written by the runner, never by a client: a hand-made run row would
  // claim something happened that did not.
  features: {
    insert: (table) => table !== "runs" && table !== "settings",
    update: (table) => table !== "runs",
    delete: (table) => table !== "settings",
    // `nestedWrites` (triggers created inline under createTask) is off: it needs an async
    // SQLite driver for its multi-statement transaction, and node:sqlite is synchronous.
    // Switching db/client.ts to libsql would turn it on; until then the UI writes the task,
    // then its triggers.
  },
  exclude: {
    // The key never needs to travel back to the browser; the UI only ever writes it.
    columns: { settings: ["apiKey"] },
  },
  // Any write can change when things fire — a new trigger, a disabled task, an edited
  // expression — so the scheduler is rebuilt after each one rather than at named call sites
  // that would drift from the mutations that need them.
  onWrite: {
    tasks: {
      before: ({ operation, args }) => {
        if (operation === "delete") {
          refuseWhileRunning(
            args,
            runningTaskIds(),
            "A running task cannot be deleted. Stop the run first.",
          );
        }
      },
      after: () => syncSoon(),
    },
    // `runs` are read-only apart from deletes, so this hook only ever guards one.
    runs: {
      before: ({ args }) =>
        refuseWhileRunning(
          args,
          runningRunIds(),
          "This run is still going. Stop it first, then delete it.",
        ),
    },
    triggers: () => syncSoon(),
    mcpServers: () => {
      void mcp.sync().catch((error) => console.error("[mcp] sync failed:", error));
    },
  },
});

/**
 * Refuses a delete that would pull the ground out from under a run in flight — a task whose
 * history would go with it, or the very row the runner is about to write the outcome to.
 * Stop the run first; a stopped one deletes like any other.
 *
 * Only the `id.eq` filter the UI sends is read. A filter this cannot resolve is refused
 * outright while anything is running: a rare, recoverable no rather than a wrong yes. Throwing
 * here rolls the mutation back before it writes.
 */
function refuseWhileRunning(args: unknown, running: Set<string>, message: string) {
  if (running.size === 0) return;
  const where = (args as { where?: { id?: { eq?: unknown } } } | undefined)?.where;
  const id = typeof where?.id?.eq === "string" ? where.id.eq : undefined;
  if (id !== undefined && !running.has(id)) return;
  // A plain Error would reach the client as "Internal server error" — the library only lets a
  // GraphQLError of its own through. This one is the client's to act on, so it says why.
  throw new GraphQLError(message, { extensions: { code: "RUN_IN_FLIGHT" } });
}

/** Generated types are keyed by the mapped name; a rename should fail loudly, not silently. */
function generatedType(name: string): GraphQLOutputType {
  const type = entities.types[name as keyof typeof entities.types];
  if (!type) {
    throw new Error(
      `drizzle-graphql did not generate a "${name}" type; it has: ${Object.keys(entities.types).join(", ")}`,
    );
  }
  return type as GraphQLOutputType;
}

const McpToolType = new GraphQLObjectType({
  name: "McpTool",
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const McpServerStatusType = new GraphQLObjectType({
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

const McpConnectionInput = new GraphQLInputObjectType({
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

const McpProbeType = new GraphQLObjectType({
  name: "McpProbe",
  description: "The result of dialling an MCP server once, without saving or pooling it.",
  fields: {
    ok: { type: new GraphQLNonNull(GraphQLBoolean) },
    error: { type: new GraphQLNonNull(GraphQLString) },
    tools: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(McpToolType))) },
  },
});

const ScheduleEntryType = new GraphQLObjectType({
  name: "ScheduleEntry",
  description: "A cron trigger that is currently armed, and when it next fires.",
  fields: {
    triggerId: { type: new GraphQLNonNull(GraphQLString) },
    taskId: { type: new GraphQLNonNull(GraphQLString) },
    cron: { type: new GraphQLNonNull(GraphQLString) },
    nextRun: { type: GraphQLString },
  },
});

const RunEventType = new GraphQLObjectType({
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
      description: "step | thinking | output | tool-call | tool-result | notice | done.",
    },
    text: { type: new GraphQLNonNull(GraphQLString) },
    name: {
      type: new GraphQLNonNull(GraphQLString),
      description: "Tool name, where there is one.",
    },
    ok: { type: GraphQLBoolean },
  },
});

export const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: {
      ...entities.queries,
      models: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))),
        description: "Model ids the configured OpenAI-compatible server reports.",
        resolve: () => listModels(),
      },
      mcpStatus: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(McpServerStatusType))),
        resolve: () => mcp.state(),
      },
      schedule: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ScheduleEntryType))),
        resolve: () => scheduleState(),
      },
      runEvents: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(RunEventType))),
        description:
          "What a run has said so far, oldest first, with consecutive thinking and output " +
          "tokens folded into one entry each. The snapshot form of the `runEvents` " +
          "subscription, for a client that polls rather than holds a stream open: pass the " +
          "`seq` of the last entry you read as `afterSeq` to pick up exactly where you left " +
          "off. Empty for a run that has not started, or one that finished over a minute ago.",
        args: {
          runId: { type: new GraphQLNonNull(GraphQLString) },
          afterSeq: {
            type: GraphQLInt,
            description: "Only what is numbered above this. Omit for the whole run.",
          },
          limit: {
            type: GraphQLInt,
            description: "At most this many entries, oldest first. Default 200.",
          },
        },
        resolve: (
          _source,
          args: { runId: string; afterSeq?: number | null; limit?: number | null },
        ) =>
          fold(history(args.runId).filter((event) => event.seq > (args.afterSeq ?? 0))).slice(
            0,
            args.limit ?? 200,
          ),
      },
    },
  }),
  mutation: new GraphQLObjectType({
    name: "Mutation",
    fields: {
      ...entities.mutations,
      runTask: {
        type: new GraphQLNonNull(generatedType("Run")),
        description:
          "Runs a task immediately and resolves with the finished run — which means it does " +
          "not answer until the run is over, and a long task is a long call. Read `runEvents` " +
          "meanwhile to watch it, or `stopTask` to call it off.",
        args: { taskId: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: (_source, args: { taskId: string }) => runTask(args.taskId),
      },
      stopTask: {
        type: new GraphQLNonNull(GraphQLBoolean),
        description:
          "Calls off a running task. False means it was not running — a stale button, not a " +
          "failure. The run is recorded as `stopped`.",
        args: { taskId: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: (_source, args: { taskId: string }) => stopTask(args.taskId),
      },
      testMcpServer: {
        type: new GraphQLNonNull(McpProbeType),
        description:
          "Connects to a config that need not be saved yet and lists its tools, so a server " +
          "can be checked before a task depends on it.",
        args: { config: { type: new GraphQLNonNull(McpConnectionInput) } },
        resolve: (_source, args: { config: Partial<McpConnection> }) =>
          probe({
            transport: args.config.transport === "http" ? "http" : "stdio",
            command: args.config.command ?? "",
            args: args.config.args ?? null,
            env: args.config.env ?? null,
            url: args.config.url ?? "",
            headers: args.config.headers ?? null,
          }),
      },
      reconnectMcp: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(McpServerStatusType))),
        description: "Tears down and rebuilds every MCP connection.",
        resolve: async () => {
          await mcp.shutdown();
          await mcp.sync();
          return mcp.state();
        },
      },
      setApiKey: {
        type: new GraphQLNonNull(GraphQLBoolean),
        description:
          "Writes the API key. Separate from updateSetting because the key is write-only: " +
          "it is excluded from the Setting type so it can never be read back out.",
        args: { apiKey: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: async (_source, args: { apiKey: string }) => {
          const { eq } = await import("drizzle-orm");
          const { settings } = await import("../db/schema.ts");
          await db.update(settings).set({ apiKey: args.apiKey }).where(eq(settings.id, "default"));
          return true;
        },
      },
    },
  }),
  subscription: new GraphQLObjectType({
    name: "Subscription",
    fields: {
      runEvents: {
        type: new GraphQLNonNull(RunEventType),
        description:
          "Watches a run as it happens. Replays what the run has said so far, then follows it " +
          "live, and completes when the run ends. Subscribing to a run that has not started " +
          "waits for it; subscribing to one long finished ends straight away.",
        args: { runId: { type: new GraphQLNonNull(GraphQLString) } },
        subscribe: (_source, args: { runId: string }) => watch(args.runId),
        resolve: (event: RunEvent) => event,
      },
    },
  }),
  types: [...Object.values(entities.types), ...Object.values(entities.inputs)],
});
