import { buildSchema, GraphQLDateTime } from "@vantreeseba/drizzle-graphql";
import { applyPermissions } from "@vantreeseba/graphql-casl";
import { eq } from "drizzle-orm";
import {
  GraphQLBoolean,
  GraphQLError,
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
import { agents, settings, steps, tasks } from "../db/schema.ts";
import { fold, history, type RunEvent, watch } from "../runner/events.ts";
import { listModels, loadSettings } from "../runner/llm.ts";
import { type McpConnection, mcp, probe } from "../runner/mcp.ts";
import { resolveConfig } from "../runner/profile.ts";
import { drainSoon, runningRunIds, runningTaskIds, runTask, stopTask } from "../runner/run.ts";
import { flush, isValidCron, state as scheduleState, syncSoon } from "../scheduler/cron.ts";
import { describeColumn, describeTable } from "./docs.ts";
import { permissions } from "./permissions.ts";
import { flattenSteps, foreignIds, type StepInput, writeTaskSteps } from "./steps.ts";
import {
  McpConnectionInput,
  McpProbeType,
  McpServerStatusType,
  RunEventType,
  ScheduleEntryType,
  StepInputType,
} from "./types.ts";

/**
 * The CRUD half of the API is generated from the Drizzle schema — tasks, triggers, runs, MCP
 * servers and settings all get their queries, filters and mutations for free, and stay in step
 * with the tables by construction. Only the handful of operations that are *not* row edits are
 * written by hand below.
 */
const { entities } = buildSchema(db, {
  // `tasks` → type `Task`, queries `tasks` (list) and `task` (single).
  typeNameMapper: "singularize",
  // Built-in detection leaves a timestamp column as `JSON`. It is a date to everyone who
  // reads it, and `DateTime` transports ISO-8601.
  mapColumnType: (column) => (column.columnType === "PgTimestamp" ? GraphQLDateTime : undefined),
  // What each column means, from `docs.ts` — the one copy of that prose. It lands on the SDL,
  // and from there on the `/mcp` tool schemas and, through codegen, the notes under the fields
  // in the web app.
  describeColumn,
  describeTable,
  // The run history — the run and the steps it took — is written by the runner, never by a
  // client: a hand-made row would claim something happened that did not.
  features: {
    insert: (table) => table !== "runs" && table !== "runSteps" && table !== "settings",
    update: (table) => table !== "runs" && table !== "runSteps",
    delete: (table) => table !== "settings",
    // `nestedWrites` (triggers created inline under createTask) is off. Nothing in the driver
    // stops it any more; it is simply not earned yet — the UI writes the task and then its
    // triggers, and a flow is written by `setTaskSteps` rather than row at a time regardless.
  },
  exclude: {
    // A key never needs to travel back to the browser; the UI only ever writes one. Both are
    // written by a mutation of their own — `setApiKey` and `setAgentApiKey` — because excluding
    // the column takes it out of the update input as well as out of the row.
    columns: { settings: ["apiKey"], agents: ["apiKey"] },
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
    triggers: {
      // A trigger nothing can fire — a bad expression, or a webhook with no address — is
      // caught here rather than becoming a row that looks armed and silently never runs.
      before: ({ operation, args }) => vetTrigger(operation, args),
      after: () => syncSoon(),
    },
    // Debounced past the commit, like the schedule above: this hook runs inside the mutation's
    // transaction, so reconnecting from here read the table as it was before the write.
    mcpServers: () => mcp.syncSoon(),
    // Raising `maxConcurrentRuns` is the one edit that can start work on its own — whatever is
    // queued for a slot can have one now. Debounced for the same reason: a drain from inside the
    // transaction would read the limit as it stood before the write that raised it.
    settings: () => drainSoon(),
  },
});

/**
 * Trims a trigger's addresses into the shape they are matched in, and refuses a write that
 * would store one nothing can ever fire.
 *
 * Both failures look identical from the outside — a row in the table, `enabled: true`, that
 * never runs — because the two things that read these columns can only skip what they cannot
 * use. The scheduler logs a cron expression it cannot parse and moves on; `POST /webhooks/<id>`
 * matches on the id, so a `kind: "event"` trigger with no id is an address nobody can reach.
 * Caught here, at the write, both are a message the client can act on.
 *
 * Every mutation shape the generated CRUD offers puts the values somewhere different, hence the
 * sweep: `values` for a create, `set` for an update, and `updates[].set` for the many-row form.
 *
 * The sweep also trims, so that the value judged here is the value stored. Both columns are
 * matched against exactly — a webhook id against the URL path, an expression against the
 * scheduler's parser — and a padded one is unfireable in the same silent way an empty one is,
 * while looking far more plausible in the table. Judging a trimmed copy and storing the padded
 * original is what let `" deploy "` through a guard whose whole purpose is to stop it.
 *
 * Each kind is only held to its own column when the write says which kind it is. An update that
 * touches one other column says nothing about the row it lands on, and an empty `cron` is what
 * an event trigger's unused column holds — so neither is read as a mistake on its own. A create
 * always says: `kind` defaults to `cron`, so values with no `kind` are a cron trigger, and one
 * with no expression is the same silent nothing as an event trigger with no address.
 */
function vetTrigger(operation: string, args: unknown) {
  const arg = args as
    | { values?: unknown; set?: unknown; updates?: { set?: unknown }[] }
    | undefined;
  const candidates = [
    ...(Array.isArray(arg?.values) ? arg.values : [arg?.values]),
    arg?.set,
    ...(arg?.updates ?? []).map((update) => update?.set),
  ];

  for (const raw of candidates) {
    const candidate = raw as { cron?: unknown; kind?: unknown; event?: unknown } | undefined;
    if (!candidate) continue;

    for (const column of ["cron", "event"] as const) {
      const value = candidate[column];
      if (typeof value === "string") candidate[column] = value.trim();
    }

    const { cron } = candidate;
    if (typeof cron === "string" && cron.trim() && !isValidCron(cron)) {
      throw new GraphQLError(`"${cron}" is not a cron expression this scheduler can read.`, {
        extensions: { code: "BAD_CRON" },
      });
    }

    // On a create the column's default settles it; on an update, silence about `kind` says
    // nothing about the row being written to.
    const kind = candidate.kind ?? (operation === "insert" ? "cron" : undefined);

    if (kind === "cron" && !String(cron ?? "").trim()) {
      throw new GraphQLError("A cron trigger needs an expression — without one it never fires.", {
        extensions: { code: "BAD_CRON" },
      });
    }

    if (kind === "event" && !String(candidate.event ?? "").trim()) {
      throw new GraphQLError("An event trigger needs a webhook id — it is the whole address.", {
        extensions: { code: "BAD_EVENT" },
      });
    }
  }
}

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

const baseSchema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: {
      ...entities.queries,
      models: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))),
        description:
          "Model ids the configured OpenAI-compatible server reports. Pass `agentId` to ask " +
          "that agent's endpoint instead — an agent with no endpoint of its own answers the " +
          "same as the server does.",
        args: {
          agentId: {
            type: GraphQLString,
            description: "Ask this agent profile's endpoint. Omit for the server's own.",
          },
        },
        resolve: async (_source, args: { agentId?: string | null }) => {
          if (!args.agentId) return listModels();
          const [agent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, args.agentId))
            .limit(1);
          return listModels(resolveConfig(await loadSettings(), agent));
        },
      },
      mcpStatus: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(McpServerStatusType))),
        description:
          "Which of the configured MCP servers this one actually reached, and the tools it " +
          "found on each. A server that is enabled but absent here failed to connect, and its " +
          "tools are not offered to any run.",
        // A reconnect owed from a write that just landed is paid off here, so that reading this
        // straight after `create_mcp_server` answers about the server you just wrote.
        resolve: async () => {
          await mcp.flush();
          return mcp.state();
        },
      },
      schedule: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ScheduleEntryType))),
        description:
          "When each armed cron trigger fires next, read from the running scheduler rather " +
          "than the table — so it answers what will happen, not what was asked for. A `cron` " +
          "trigger missing here is not armed, which usually means it or its task is disabled. " +
          "`event` triggers never appear; they fire on a webhook, not a clock.",
        // A rebuild owed from a write that just landed is paid off here, so that reading this
        // straight after `createTrigger` answers about the trigger you just wrote.
        resolve: async () => {
          await flush();
          return scheduleState();
        },
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
          "meanwhile to watch it, or `stopTask` to call it off.\n\n" +
          "Finished is not the same as succeeded. A run that failed comes back the same way a " +
          "run that worked does, and `status` is what separates them — `ok`, `error` with the " +
          "reason in `error`, or `stopped` if it was called off. Only a task that could not be " +
          "started at all is an error here, and the usual reason is that it is already running " +
          "— or that as many runs are already going as the server allows.\n\n" +
          "`payload` is a webhook body handed over by hand: it is stored on the run and " +
          "rendered as `{{event}}` in the prompt, exactly as a real delivery would be. Pass " +
          "the payload of an earlier run to replay it, or one you have made up to try an " +
          "`{{event}}` prompt before any sender exists. The run is still a hand-started one " +
          "and names no trigger.",
        args: {
          taskId: { type: new GraphQLNonNull(GraphQLString) },
          payload: { type: GraphQLJSON },
        },
        resolve: (_source, args: { taskId: string; payload?: unknown }) =>
          runTask(args.taskId, undefined, args.payload ?? undefined),
      },
      stopTask: {
        type: new GraphQLNonNull(GraphQLBoolean),
        description:
          "Calls off a running task. False means it was not running — a stale button, not a " +
          "failure. The run is recorded as `stopped`.",
        args: { taskId: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: (_source, args: { taskId: string }) => stopTask(args.taskId),
      },
      setTaskSteps: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(generatedType("Step")))),
        description:
          "Replaces a task's whole flow in one transaction, and returns it flattened into rows " +
          "in the order it runs. A flow is only correct as a whole — a step's parent, its arm " +
          "and its place in that arm are all relative to its siblings — so it is written as a " +
          "whole rather than a row at a time. Steps sent back with their existing ids are " +
          "edited in place and keep the run history that points at them; the rest are replaced. " +
          "Pass an empty list to run the task's own prompt and nothing else.",
        args: {
          taskId: { type: new GraphQLNonNull(GraphQLString) },
          steps: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(StepInputType))) },
        },
        resolve: async (_source, args: { taskId: string; steps: StepInput[] }) => {
          const [task] = await db.select().from(tasks).where(eq(tasks.id, args.taskId)).limit(1);
          if (!task) {
            throw new GraphQLError(`There is no task with id ${args.taskId}.`, {
              extensions: { code: "NOT_FOUND" },
            });
          }
          // The run in flight read the flow when it started and is recording what it executed
          // against those very rows; editing them now would make its own account of itself lie.
          if (runningTaskIds().has(args.taskId)) {
            throw new GraphQLError("This task is running. Stop it first, then edit its steps.", {
              extensions: { code: "RUN_IN_FLIGHT" },
            });
          }

          const rows = flattenSteps(args.taskId, args.steps);
          const foreign = await foreignIds(args.taskId, rows);
          if (foreign.length) {
            throw new GraphQLError(
              `These step ids already belong to another task: ${foreign.join(", ")}.`,
              { extensions: { code: "BAD_STEPS" } },
            );
          }
          await writeTaskSteps(args.taskId, rows);

          const written = await db.select().from(steps).where(eq(steps.taskId, args.taskId));
          const order = new Map(rows.map((row, at) => [row.id, at]));
          return written.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        },
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
      setAgentApiKey: {
        type: new GraphQLNonNull(GraphQLBoolean),
        description:
          "Writes one agent profile's API key. Separate from updateAgent for the reason " +
          "`setApiKey` is separate from updateSetting: the key is write-only, excluded from the " +
          "Agent type so it can never be read back out. An empty string clears it, which puts " +
          "the profile back on the server's key — unless it has an endpoint of its own, which " +
          "is never sent the server's key.",
        args: {
          agentId: { type: new GraphQLNonNull(GraphQLString) },
          apiKey: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: async (_source, args: { agentId: string; apiKey: string }) => {
          const updated = await db
            .update(agents)
            .set({ apiKey: args.apiKey })
            .where(eq(agents.id, args.agentId))
            .returning({ id: agents.id });
          if (!updated.length) {
            throw new GraphQLError(`There is no agent with id ${args.agentId}.`, {
              extensions: { code: "NOT_FOUND" },
            });
          }
          return true;
        },
      },
      setApiKey: {
        type: new GraphQLNonNull(GraphQLBoolean),
        description:
          "Writes the API key. Separate from updateSetting because the key is write-only: " +
          "it is excluded from the Setting type so it can never be read back out.",
        args: { apiKey: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: async (_source, args: { apiKey: string }) => {
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

/**
 * The schema every caller gets, rules and all.
 *
 * Wrapped here rather than at either endpoint, because there is one schema and two doors: a
 * rule bolted onto `/mcp` says nothing about the same field reached over `/graphql`, and the
 * MCP endpoint projects its tools from this very object. Wrapping the export is what makes
 * there be no unguarded path — `permissions.ts` says who may call what, and this is the only
 * place it is put on.
 *
 * `allowExternalErrors` stays at its default: a refusal that came from a resolver — the cron
 * expression `vetTrigger` will not store, the delete `refuseWhileRunning` holds off — is the
 * whole of what the caller needs told, and replacing it with `Forbidden` would lose it.
 */
export const schema = applyPermissions(baseSchema, permissions, {
  fallbackError: (_original, _parent, _args, _context, info) =>
    new GraphQLError(`Not authorized to call ${info.parentType.name}.${info.fieldName}.`, {
      extensions: { code: "FORBIDDEN" },
    }),
});
