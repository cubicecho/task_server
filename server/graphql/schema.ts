import { buildSchema, GraphQLDateTime } from "@vantreeseba/drizzle-graphql";
import {
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  type GraphQLOutputType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import { db } from "../db/client.ts";
import { listModels } from "../runner/llm.ts";
import { mcp } from "../runner/mcp.ts";
import { runTask } from "../runner/run.ts";
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
    tasks: () => syncSoon(),
    triggers: () => syncSoon(),
    mcpServers: () => {
      void mcp.sync().catch((error) => console.error("[mcp] sync failed:", error));
    },
  },
});

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
    },
  }),
  mutation: new GraphQLObjectType({
    name: "Mutation",
    fields: {
      ...entities.mutations,
      runTask: {
        type: new GraphQLNonNull(generatedType("Run")),
        description: "Runs a task immediately and resolves with the finished run.",
        args: { taskId: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: (_source, args: { taskId: string }) => runTask(args.taskId),
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
  types: [...Object.values(entities.types), ...Object.values(entities.inputs)],
});
