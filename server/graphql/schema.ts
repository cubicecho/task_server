import { fold, history, type RunEvent, watch } from "@cubicecho/agent-core";
import { buildSchema, extractFilters, GraphQLDateTime } from "@vantreeseba/drizzle-graphql";
import { applyPermissions } from "@vantreeseba/graphql-casl";
import { eq, inArray } from "drizzle-orm";
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
import { agents, mcpServers, runs, settings, steps, tasks, triggers } from "../db/schema.ts";
import { hookProblems, runsDeleted } from "../runner/hooks.ts";
import { listModels, loadSettings } from "../runner/llm.ts";
import { mcp, probe } from "../runner/mcp.ts";
import * as mcpPrompts from "../runner/mcp-prompts.ts";
import { resolveConfig } from "../runner/profile.ts";
import { drainSoon, runningRunIds, runningTaskIds, runTask, stopTask } from "../runner/run.ts";
import { flush, isValidCron, state as scheduleState, syncSoon } from "../scheduler/cron.ts";
import { exportAgent, type ImportOptions, importAgent, previewImport } from "./agent-spec.ts";
import { describeColumn, describeTable } from "./docs.ts";
import { NEW_MCP_SERVER, shapeProblems } from "./mcp-server.ts";
import { permissions } from "./permissions.ts";
import { flattenSteps, foreignIds, type StepInput, writeTaskSteps } from "./steps.ts";
import {
  AgentSpecPreviewType,
  McpConnectionInput,
  McpProbeType,
  McpPromptType,
  McpServerStatusType,
  RunEventType,
  ScheduleEntryType,
  StepInputType,
} from "./types.ts";

/** `McpConnectionInput` as it arrives: both arms' fields, all of them optional but the transport. */
type McpConnectionArgs = {
  transport: string;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
  headers?: Record<string, string> | null;
};

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
      before: async ({ operation, args, tx }) => {
        if (operation === "delete") {
          refuseWhileRunning(
            args,
            runningTaskIds(),
            "A running task cannot be deleted. Stop the run first.",
          );
          // The task's runs go with it by cascade, so the hooks' `sessionDelete` has to be told
          // their ids now: by `after` there is nothing left to read them from.
          doomedRuns.set(args, await runsOfTasks(tx, args));
        }
      },
      after: ({ operation, args }) => {
        if (operation === "delete") {
          runsDeleted(doomedRuns.get(args) ?? []);
          doomedRuns.delete(args);
        }
        syncSoon();
      },
    },
    // `runs` are read-only apart from deletes, so this hook only ever guards one.
    runs: {
      before: ({ args }) =>
        refuseWhileRunning(
          args,
          runningRunIds(),
          "This run is still going. Stop it first, then delete it.",
        ),
      // Once the delete has returned its rows, so a memory server is only ever told to forget a
      // run that is really gone. A rolled-back transaction after this is the one gap, and a
      // forgotten memory of a run that still exists costs less than a remembered one that doesn't.
      after: ({ operation, rows }) => {
        if (operation === "delete") runsDeleted((rows as { id: string }[]).map((row) => row.id));
      },
    },
    triggers: {
      // A trigger nothing can fire — a bad expression, or a webhook with no address — is
      // caught here rather than becoming a row that looks armed and silently never runs.
      before: ({ args, tx }) => vetTrigger(tx, args),
      after: () => syncSoon(),
    },
    // Debounced past the commit, like the schedule above: this hook runs inside the mutation's
    // transaction, so reconnecting from here read the table as it was before the write.
    mcpServers: {
      before: ({ args, tx }) => vetMcpServer(tx, args),
      after: () => mcp.syncSoon(),
    },
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
 * The sweep also trims, so that the value judged here is the value stored. Both columns are
 * matched against exactly — a webhook id against the URL path, an expression against the
 * scheduler's parser — and a padded one is unfireable in the same silent way an empty one is,
 * while looking far more plausible in the table. Judging a trimmed copy and storing the padded
 * original is what let `" deploy "` through a guard whose whole purpose is to stop it.
 *
 * Which column a trigger is held to depends on its kind, and an update need not say the kind, so
 * the change is laid over each row it lands on and the result is what is judged. Judged alone,
 * `set: { event: "" }` on an event trigger said nothing about a kind and was let through. Only
 * what the write introduces is refused, as for an MCP server below.
 */
async function vetTrigger(tx: typeof db, args: unknown) {
  const { created, changed } = writesOf(args);
  for (const written of [...created, ...changed.map(({ set }) => set)]) {
    for (const column of ["cron", "event"]) {
      const value = written[column];
      if (typeof value === "string") written[column] = value.trim();
    }
  }

  for (const values of created) refuseTrigger({ ...NEW_TRIGGER, ...values });
  for (const { where, set } of changed) {
    const filter = where
      ? extractFilters(triggers, "triggers", where as Parameters<typeof extractFilters>[2])
      : undefined;
    for (const stored of await tx.select().from(triggers).where(filter)) {
      refuseTrigger({ ...stored, ...set }, stored);
    }
  }
}

/** The columns' own defaults, which a create that leaves them out is going to get. */
const NEW_TRIGGER = { kind: "cron", cron: "", event: "" };

/** Why nothing could ever fire this trigger, if nothing could. */
function triggerProblem(row: Record<string, unknown>): GraphQLError | undefined {
  const cron = String(row.cron ?? "");
  if (cron && !isValidCron(cron)) {
    return new GraphQLError(`"${cron}" is not a cron expression this scheduler can read.`, {
      extensions: { code: "BAD_CRON" },
    });
  }
  if (row.kind === "cron" && !cron) {
    return new GraphQLError("A cron trigger needs an expression — without one it never fires.", {
      extensions: { code: "BAD_CRON" },
    });
  }
  if (row.kind === "event" && !row.event) {
    return new GraphQLError("An event trigger needs a webhook id — it is the whole address.", {
      extensions: { code: "BAD_EVENT" },
    });
  }
}

/** Throws for what is wrong with `row` and was not already wrong with the row it replaces. */
function refuseTrigger(row: Record<string, unknown>, stored?: Record<string, unknown>) {
  const problem = triggerProblem(row);
  if (problem && problem.message !== (stored && triggerProblem(stored))?.message) throw problem;
}

/**
 * The parts of a generated write, wherever its shape put them: `values` for a create, `where`
 * and `set` for an update, and `updates[]` for the many-row form of one.
 */
function writesOf(args: unknown) {
  type Row = Record<string, unknown>;
  type Update = { where?: unknown; set?: Row } | undefined;
  const arg = (args ?? {}) as { values?: Row | Row[]; updates?: Update[] } & Update;
  const created = [arg.values].flat().filter((values) => values !== undefined);
  const changed = [arg, ...(arg.updates ?? [])].flatMap((update) =>
    update?.set ? [{ where: update.where, set: update.set }] : [],
  );
  return { created, changed };
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

/**
 * The run ids of the tasks a delete is about to remove, keyed by the mutation's own arguments
 * object — the one both of its hooks are handed — so its `after` finds them. A `WeakMap` so a delete that fails between the two leaks
 * nothing.
 */
const doomedRuns = new WeakMap<object, string[]>();

async function runsOfTasks(tx: typeof db, args: unknown): Promise<string[]> {
  const where = (args as { where?: unknown } | undefined)?.where;
  if (!where || typeof where !== "object") return [];
  try {
    const filter = extractFilters(tasks, "tasks", where as Parameters<typeof extractFilters>[2]);
    const doomed = tx.select({ id: tasks.id }).from(tasks).where(filter);
    const rows = await tx.select({ id: runs.id }).from(runs).where(inArray(runs.taskId, doomed));
    return rows.map((row) => row.id);
  } catch (error) {
    // A filter this cannot read is a delete that goes ahead with its runs' hooks unfired, not a
    // delete that fails: forgetting is the hooks' business, and deleting is the operator's.
    console.warn(`[hooks] could not list the runs of a deleted task: ${error}`);
    return [];
  }
}

/**
 * Refuses an MCP server row the pool could not use as written: hooks that could never run, a
 * `hiddenTools` that is not a list of names, a stdio server with no command, a url that is not
 * http, a slug that cannot namespace a tool. The shape rules are the pool's own
 * `validateServerConfig`, the same ones the form reads, so what is refused on save is what was
 * marked as typed.
 *
 * That check wants a whole row and an update is handed part of one, so the change is laid over
 * each row it is about to land on. Only what the write introduces is refused: a row that was
 * saved before a rule existed can still be disabled, renamed or repaired a column at a time.
 */
async function vetMcpServer(tx: typeof db, args: unknown) {
  const { created, changed } = writesOf(args);
  for (const values of created) refuseMcpServer({ ...NEW_MCP_SERVER, ...values });
  for (const { where, set } of changed) {
    const filter = where
      ? extractFilters(mcpServers, "mcpServers", where as Parameters<typeof extractFilters>[2])
      : undefined;
    for (const stored of await tx.select().from(mcpServers).where(filter)) {
      refuseMcpServer({ ...stored, ...set }, stored);
    }
  }
}

/** Throws for what is wrong with `row` and was not already wrong with the row it replaces. */
function refuseMcpServer(row: Record<string, unknown>, stored?: Record<string, unknown>) {
  const known = stored ? [...shapeProblems(stored), ...hookProblems(stored.hooks)] : [];
  const fresh = (problems: string[]) => problems.filter((problem) => !known.includes(problem));

  const problems = fresh(shapeProblems(row));
  if (problems.length) {
    throw new GraphQLError(`This server cannot be saved as written: ${problems.join("; ")}`, {
      extensions: { code: "BAD_MCP_SERVER", problems },
    });
  }
  const hooks = fresh(hookProblems(row.hooks));
  if (hooks.length) {
    throw new GraphQLError(`These hooks cannot run as written: ${hooks.join("; ")}`, {
      extensions: { code: "BAD_HOOKS", problems: hooks },
    });
  }
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

/**
 * The preview and the write take the same arguments, declared once: a preview that could be
 * asked a different question from the import it stands for is not a preview of it.
 */
const IMPORT_ARGS = {
  document: {
    type: new GraphQLNonNull(GraphQLJSON),
    description: "The agent spec, as parsed JSON.",
  },
  createServers: {
    type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
    description:
      "The bundled MCP servers to create, by slug. Absent or empty creates none, and a slug " +
      "in the document then means the server of that name already here.",
  },
  name: {
    type: GraphQLString,
    description: "Save the profile under this name instead of the document's own.",
  },
};

type ImportArgs = ImportOptions & { document: unknown };

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
      agentSpec: {
        type: new GraphQLNonNull(GraphQLJSON),
        description:
          "One agent profile as an agent spec (`cubicecho.agent/1`), the document another host " +
          "reads a profile from. A column left to inherit is a field the document does not " +
          "have. The MCP servers the profile is narrowed to are named by slug under " +
          "`tools.servers` and defined under `bundle.mcpServers`. It carries no credential: " +
          "not the profile's API key, and not a bundled server's `env` or `headers`.",
        args: { agentId: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: (_source, args: { agentId: string }) => exportAgent(args.agentId),
      },
      agentSpecPreview: {
        type: new GraphQLNonNull(AgentSpecPreviewType),
        description:
          "What `importAgentSpec` would do with the same arguments, without writing anything: " +
          "the profile it would save, each thing dropped on the way, the MCP servers the " +
          "document bundles, and any reason the import would be refused. Read this before " +
          "importing — a bundled server is a command line somebody else wrote.",
        args: IMPORT_ARGS,
        resolve: (_source, { document, ...options }: ImportArgs) =>
          previewImport(document, options),
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
      mcpPrompts: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(McpPromptType))),
        description:
          "The prompts the connected MCP servers offer, for a picker — a prompt is the server " +
          "author's own phrasing of a job that server is good at. Expand one with `mcpPrompt` " +
          "and the text becomes a task's or a step's prompt, editable before it is saved. " +
          "Empty when no connected server offers any; a server that cannot be listed is left " +
          "out rather than failing the query.",
        resolve: () => mcpPrompts.list(),
      },
      mcpPrompt: {
        type: new GraphQLNonNull(GraphQLString),
        description:
          "One prompt from `mcpPrompts`, expanded with the arguments given and flattened to " +
          "the single string a prompt is. A template that answers with more than one message " +
          "comes back with its roles labelled.",
        args: {
          server: {
            type: new GraphQLNonNull(GraphQLString),
            description: "The MCP server row's id, as `mcpPrompts` reports it.",
          },
          name: { type: new GraphQLNonNull(GraphQLString) },
          args: {
            type: GraphQLJSON,
            description: "The prompt's arguments by name. Absent is the same as none.",
          },
        },
        resolve: (_source, args: { server: string; name: string; args?: unknown }) =>
          mcpPrompts.get(args.server, args.name, (args.args ?? {}) as Record<string, string>),
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
        // The input is flat, the connection a union on `transport`: only the arm it names is built,
        // so a stdio probe is never handed a `url` it would not read.
        resolve: (_source, { config }: { config: McpConnectionArgs }) =>
          probe(
            config.transport === "http"
              ? { transport: "http", url: config.url ?? "", headers: config.headers ?? null }
              : {
                  transport: "stdio",
                  command: config.command ?? "",
                  args: config.args ?? null,
                  env: config.env ?? null,
                },
          ),
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
      importAgentSpec: {
        type: new GraphQLNonNull(generatedType("Agent")),
        description:
          "Saves an agent spec (`cubicecho.agent/1`) as a new agent profile, and answers with " +
          "it. A field the document leaves out is left to inherit, and one a profile has no " +
          "column for is dropped — `agentSpecPreview` lists which. The profile has no API key " +
          "until `setAgentApiKey` gives it one.\n\n" +
          "Refused whole, with nothing written, when the document is not a spec; when " +
          "`createServers` names a slug that is already an MCP server here; or when none of " +
          "the servers the agent is narrowed to exist here, since a profile with none listed " +
          "reaches every server. A slug that is merely missing is dropped from the list.",
        args: IMPORT_ARGS,
        resolve: (_source, { document, ...options }: ImportArgs) => importAgent(document, options),
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
        // The request's signal is how a client that leaves early is let go: without it the watcher
        // waits at an `await` for the next event, and holds the run's backlog past its deadline.
        subscribe: (_source, args: { runId: string }, context?: { request?: Request }) =>
          watch(args.runId, context?.request?.signal),
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
