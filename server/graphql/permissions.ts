import {
  Actions,
  accept,
  createCan,
  createGraphQLAbility,
  deny,
  type PermissionsMap,
  type Rule,
} from "@vantreeseba/graphql-casl";

/**
 * Who may call what, in one place.
 *
 * This used to be said once and enforced nowhere. `TOOLS` in `mcp-endpoint.ts` lists the
 * seventeen fields a visiting agent is offered — deliberately not the settings row, not the MCP
 * server rows, and not a bulk write — but a listing is not a lock. Both endpoints are one
 * schema in one process, so an agent handed those seventeen tools could also post to `/graphql`
 * and call `deleteTask` with no `where`, which empties the table, or `setApiKey`, or
 * `testMcpServer`, which spawns whatever command it is handed. The tool list decided what an
 * agent was *told about*; nothing decided what it could *reach*.
 *
 * So the rules are here and go on the schema itself rather than on either endpoint, which is
 * what makes them true of both. `TOOLS` stays what it always was and is now only a listing —
 * an agent's context is worth spending deliberately, and seventeen tools is a different
 * question from what the fortieth root field would do.
 *
 * Mutations are a whitelist: every one is denied unless it is named below, so a write added by
 * a new table ships shut rather than open. Reads are the other way round and deliberately so —
 * the two things worth keeping from a reader are the operator's own settings row and how this
 * server is wired to other people's, and those are named.
 */

/**
 * The subjects rules are written against: the GraphQL types, which are the tables.
 *
 * Named as a type rather than inferred from generated resolvers, which this repo does not emit
 * — `typescript-resolvers` over the whole generated surface is a build of its own for a list of
 * seven names, and the web app's codegen is client documents only. A subject the schema has not
 * got is caught when the map is applied, which is as the server is built rather than on the
 * request that would have needed it.
 */
type SubjectName =
  | "Task"
  | "Trigger"
  | "Step"
  | "Run"
  | "RunStep"
  | "McpServer"
  | "Setting"
  | "Agent";

type Subjects = Record<SubjectName, Record<string, unknown>>;

/**
 * Which kind of caller a request is, which is the whole of the identity this server has.
 *
 * There are no accounts, and there is no token — this is a tool one person points at their own
 * tasks. What there is instead is two doors used by two different kinds of thing: `/mcp` is
 * where agents call in, and `/graphql` is where the web app does. That is enough to say an
 * agent may write and run tasks but not re-key the server or re-wire it.
 *
 * A request with no context at all is one nothing built a context for — a test calling
 * `graphql()` directly, or this server executing its own schema in process. Those are the
 * operator.
 */
export type Caller = "operator" | "agent";

/** What the resolvers are handed. `caller` is the only thing any rule reads. */
export interface GraphContext {
  caller: Caller;
}

const BOARD = ["Task", "Trigger", "Step"] as const;

/**
 * What each kind of caller may do.
 *
 * The operator is the person whose server this is, and there is nothing here they may not do —
 * the web app is the whole of the API. An agent writes and runs tasks: it makes them, edits
 * their flows, schedules them, starts and stops them, and reads what happened. What it may not
 * do is re-key the server or re-wire it, because which endpoint runs on whose key, and which
 * MCP servers this one dials, are the operator's business.
 *
 * Agent profiles are the third refusal, and they are the settings row again in miniature: a
 * profile carries an endpoint and a key of its own, and says which MCP servers a task on it may
 * reach. An agent that could write one could point a task at a model of its choosing and hand it
 * every tool this server has; one that could read them has read the operator's map of which
 * endpoint runs on whose key. A task still carries its `agentId` either way, so a visiting agent
 * can see that a task runs on a profile — it just cannot choose or change which.
 *
 * Two of those refusals are worth naming. The settings row is the operator's account of their
 * own server — endpoint, model, key — and `setApiKey` writes a credential; an agent that can
 * repoint `baseUrl` has redirected every future run's prompt to a server of its choosing. The
 * MCP server rows carry `env` and `headers`, which are credentials in all but name, and
 * `testMcpServer` spawns a stdio command from an unsaved config, so it is arbitrary execution
 * on this host for anyone who can reach it.
 *
 * A step is not written a row at a time. `setTaskSteps` is the door — a flow is only correct as
 * a whole, since a step's parent, its arm and its place in that arm are all relative to its
 * siblings — so an agent gets that mutation, as `update` on the task whose flow it rewrites,
 * and the generated per-row step writes stay with the operator.
 *
 * Deleting a run stays with the operator too. The history is the account of what this server
 * did, and an agent tidying away the run that recorded what it did is the one edit nobody can
 * audit afterwards.
 */
function abilitiesFor(caller: Caller) {
  const { can, build } = createGraphQLAbility<Subjects>();
  if (caller === "operator") {
    can(Actions.manage, [...BOARD, "Run", "RunStep", "McpServer", "Setting", "Agent"]);
    return build();
  }
  can(Actions.read, [...BOARD, "Run", "RunStep"]);
  can([Actions.create, Actions.update, Actions.delete], ["Task", "Trigger"]);
  return build();
}

const callerOf = (ctx: Partial<GraphContext> | undefined) => ctx?.caller ?? "operator";

const canUser = createCan<Partial<GraphContext> | undefined, Subjects>(
  async (ctx) => abilitiesFor(callerOf(ctx)),
  // Everything past the door is a caller of some kind, and there is no door: this server has no
  // authentication at all, so a request that arrived is authenticated by definition.
  () => true,
);

/**
 * The mutations that are allowed at all, each with what it does and to what.
 *
 * A bulk write is in none of them, which is the point. `deleteTask` with no `where` empties the
 * table and `deleteTaskSingle` cannot; `updateTask` with no `where` rewrites every row. They
 * were already left out of the tool listing, and the web app has never called one — every
 * document under `web/graphql/` uses a single-row form — so shutting them costs no caller
 * anything and closes the one call on this schema that can lose a table.
 */
const MUTATIONS: Record<string, Rule> = {
  // Denied unless named. A generated mutation added by a new table arrives shut, and so does
  // every bulk form of the ones below.
  "*": deny,

  createTask: canUser(Actions.create, "Task"),
  updateTaskSingle: canUser(Actions.update, "Task"),
  deleteTaskSingle: canUser(Actions.delete, "Task"),

  createTrigger: canUser(Actions.create, "Trigger"),
  updateTriggerSingle: canUser(Actions.update, "Trigger"),
  deleteTriggerSingle: canUser(Actions.delete, "Trigger"),

  createStep: canUser(Actions.create, "Step"),
  updateStepSingle: canUser(Actions.update, "Step"),
  deleteStepSingle: canUser(Actions.delete, "Step"),

  // A task being run, stopped, or given a new flow, rather than a row being edited — which is
  // why all three are hand-written, and why all three ask after the task.
  runTask: canUser(Actions.update, "Task"),
  stopTask: canUser(Actions.update, "Task"),
  setTaskSteps: canUser(Actions.update, "Task"),

  deleteRunSingle: canUser(Actions.delete, "Run"),
  deleteRunStepSingle: canUser(Actions.delete, "RunStep"),

  createMcpServer: canUser(Actions.create, "McpServer"),
  updateMcpServerSingle: canUser(Actions.update, "McpServer"),
  deleteMcpServerSingle: canUser(Actions.delete, "McpServer"),
  // Neither writes a row, and both are the pool rather than the table: one dials a config that
  // need not be saved yet, the other tears every connection down and rebuilds it.
  testMcpServer: canUser(Actions.update, "McpServer"),
  reconnectMcp: canUser(Actions.update, "McpServer"),

  updateSettingSingle: canUser(Actions.update, "Setting"),
  setApiKey: canUser(Actions.update, "Setting"),

  createAgent: canUser(Actions.create, "Agent"),
  updateAgentSingle: canUser(Actions.update, "Agent"),
  deleteAgentSingle: canUser(Actions.delete, "Agent"),
  // Write-only, exactly as `setApiKey` is, and for the same reason.
  setAgentApiKey: canUser(Actions.update, "Agent"),
};

/**
 * Reading one table, in the four ways a generated schema offers it.
 *
 * Guarding `settings` and leaving `settingsGroupBy` is guarding the front door of a room with
 * two: `settingsGroupBy(groupBy: [baseUrl, model])` answers with the same column values under a
 * different heading, and `settingsAggregate { max { … } }` answers with them one at a time.
 * They are one permission, so they are written as one.
 */
const tableReads = (
  single: string,
  plural: string,
  subject: SubjectName,
): Record<string, Rule> => ({
  [single]: canUser(Actions.read, subject),
  [plural]: canUser(Actions.read, subject),
  [`${plural}Aggregate`]: canUser(Actions.read, subject),
  [`${plural}GroupBy`]: canUser(Actions.read, subject),
});

export const permissions: PermissionsMap = {
  // Reading a row is reading a row. The one thing kept back from a *reader* outright is the API
  // key, and `exclude.columns` drops it from the types, so no rule here has to remember it.
  "*": accept,
  Query: {
    "*": accept,
    // The two tables an agent is not shown. The settings row is the operator's account of their
    // own server — which endpoint, which model, what it costs. The MCP servers are how this
    // server is wired rather than what it is working on, and `env` and `headers` on one of
    // those rows are credentials in all but name: an agent reading them has read somebody's
    // keys.
    ...tableReads("setting", "settings", "Setting"),
    ...tableReads("mcpServer", "mcpServers", "McpServer"),
    // And the profiles, which are the settings row per task: an endpoint, a key, and which of
    // those MCP servers a task on the profile may reach.
    ...tableReads("agent", "agents", "Agent"),
    // The same servers, answered from the live pool instead of the table. It carries no
    // credentials, but it is the same list of what this server dials and with which tools.
    mcpStatus: canUser(Actions.read, "McpServer"),
  },
  Mutation: MUTATIONS,

  // And the way in that is not a query. A rule on the type guards every field of it wherever it
  // is reached, so a relation walked to from a table an agent may read lands on the same
  // refusal as the entry point does. Nothing relates to either of these today; the rule is what
  // keeps that true of the relation a new column adds tomorrow.
  Setting: canUser(Actions.read, "Setting"),
  McpServer: canUser(Actions.read, "McpServer"),
  // This one is not hypothetical: `Task.agent` is a relation an agent may walk to from a task
  // it is allowed to read, and the rule on the type is what meets it there.
  Agent: canUser(Actions.read, "Agent"),
};
