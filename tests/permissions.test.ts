import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePermissions } from "@vantreeseba/graphql-casl";
import { type GraphQLResolveInfo, type GraphQLSchema, graphql } from "graphql";
import { afterAll, beforeAll, expect, test } from "vitest";

// The schema is built from the live Drizzle tables at import time, so the database has to be
// pointed somewhere disposable before anything under server/ is loaded.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-perms-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let schema: GraphQLSchema;
let cron: typeof import("../server/scheduler/cron.ts");
let permissions: typeof import("../server/graphql/permissions.ts").permissions;
let TOOLS: typeof import("../server/mcp-endpoint.ts").TOOLS;

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  schema = (await import("../server/graphql/schema.ts")).schema;
  cron = await import("../server/scheduler/cron.ts");
  permissions = (await import("../server/graphql/permissions.ts")).permissions;
  TOOLS = (await import("../server/mcp-endpoint.ts")).TOOLS;
});

afterAll(async () => {
  await cron.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The same schema both doors serve, asked as one caller or the other. */
const ask = (source: string, caller?: "operator" | "agent") =>
  graphql({ schema, source, contextValue: caller ? { caller } : undefined });

const refused = async (source: string, caller?: "operator" | "agent") => {
  const { errors } = await ask(source, caller);
  return (errors ?? []).map((error) => error.extensions?.code);
};

const allowed = async (source: string, caller?: "operator" | "agent") => {
  const { errors } = await ask(source, caller);
  expect(errors).toBeUndefined();
};

test("an agent may write and run the things it is given tools for", async () => {
  await allowed(
    `mutation { createTask(values: { name: "nightly", prompt: "go" }) { id } }`,
    "agent",
  );
  const { data } = await ask(`{ tasks { id } }`, "agent");
  const [task] = (data as { tasks: { id: string }[] }).tasks;

  await allowed(
    `mutation { updateTaskSingle(set: { enabled: false }, where: { id: { eq: "${task.id}" } }) { id } }`,
    "agent",
  );
  await allowed(
    `mutation { createTrigger(values: { taskId: "${task.id}", cron: "0 9 * * *" }) { id } }`,
    "agent",
  );
  await allowed(
    `{ runs { id } steps { id } runSteps { id } triggers { id } schedule { cron } }`,
    "agent",
  );
});

// The four ways a generated schema offers one table, because guarding the plural alone guards
// the front door of a room with two: `settingsGroupBy(groupBy: [baseUrl])` answers with the same
// column values under a different heading.
test("the settings row is the operator's, whichever way it is asked for", async () => {
  for (const source of [
    `{ settings { baseUrl } }`,
    `{ setting(where: { id: { eq: "default" } }) { baseUrl } }`,
    `{ settingsAggregate { max { baseUrl } } }`,
    `{ settingsGroupBy(groupBy: [baseUrl]) { group { baseUrl } } }`,
    `mutation { setApiKey(apiKey: "sk-agent") }`,
    `mutation { updateSettingSingle(set: { baseUrl: "https://elsewhere" }, where: { id: { eq: "default" } }) { id } }`,
  ]) {
    expect(await refused(source, "agent"), source).toEqual(["FORBIDDEN"]);
    expect(await refused(source, "operator"), source).toEqual([]);
  }
});

// `env` and `headers` on one of these rows are credentials in all but name, and `testMcpServer`
// spawns whatever stdio command it is handed — arbitrary execution for anyone who reaches it.
test("how this server is wired is the operator's too", async () => {
  for (const source of [
    `{ mcpServers { slug } }`,
    `{ mcpServersGroupBy(groupBy: [slug]) { group { slug } } }`,
    `{ mcpStatus { slug } }`,
    `mutation { createMcpServer(values: { slug: "probe", command: "sh" }) { id } }`,
    `mutation { testMcpServer(config: { transport: "stdio", command: "sh" }) { ok } }`,
    `mutation { reconnectMcp { slug } }`,
  ]) {
    expect(await refused(source, "agent"), source).toEqual(["FORBIDDEN"]);
  }
});

// A profile is the settings row per task: an endpoint, a key of its own, and which MCP servers
// a task on it may reach. An agent that could write one could point a task at a model of its
// choosing and hand it every tool this server has.
test("agent profiles are the settings row again, and just as shut", async () => {
  for (const source of [
    `{ agents { baseUrl } }`,
    `{ agent(where: { id: { eq: "x" } }) { baseUrl } }`,
    `{ agentsAggregate { max { baseUrl } } }`,
    `{ agentsGroupBy(groupBy: [baseUrl]) { group { baseUrl } } }`,
    `mutation { createAgent(values: { name: "mine" }) { id } }`,
    `mutation { updateAgentSingle(set: { baseUrl: "https://elsewhere" }, where: { id: { eq: "x" } }) { id } }`,
    `mutation { deleteAgentSingle(where: { id: { eq: "x" } }) { id } }`,
    `mutation { setAgentApiKey(agentId: "x", apiKey: "sk-agent") }`,
  ]) {
    expect(await refused(source, "agent"), source).toEqual(["FORBIDDEN"]);
  }
});

// The rule is on the type, not on the query, so the relation lands on the same refusal the
// entry point does — a task an agent may read is not a way round the profile it runs on.
test("a task's profile is not readable through the task", async () => {
  await allowed(
    `mutation { createAgent(values: { name: "local", baseUrl: "http://x/v1" }) { id } }`,
  );
  const { data } = await ask(`{ agents { id } }`);
  const [agent] = (data as { agents: { id: string }[] }).agents;
  await allowed(
    `mutation { createTask(values: { name: "on a profile", prompt: "go", agentId: "${agent.id}" }) { id } }`,
  );

  expect(await refused(`{ tasks { id agent { baseUrl } } }`, "agent")).toEqual(["FORBIDDEN"]);
  // The id itself stays: a visiting agent can see that a task runs on a profile.
  await allowed(`{ tasks { id agentId } }`, "agent");
});

// The history is this server's account of what it did, and an agent tidying away the run that
// recorded what it did is the one edit nobody can audit afterwards.
test("an agent does not delete the history", async () => {
  expect(
    await refused(`mutation { deleteRunSingle(where: { id: { eq: "x" } }) { id } }`, "agent"),
  ).toEqual(["FORBIDDEN"]);
  expect(
    await refused(`mutation { deleteRunStepSingle(where: { id: { eq: "x" } }) { id } }`, "agent"),
  ).toEqual(["FORBIDDEN"]);
});

// The one call on this schema that can lose a table, shut for every caller — the web app has
// never sent one, and `deleteTaskSingle` cannot empty anything.
test("a bulk write is nobody's, the operator included", async () => {
  for (const source of [
    `mutation { deleteTask { id } }`,
    `mutation { createTasks(values: [{ name: "bulk", prompt: "go" }]) { id } }`,
    `mutation { updateTask(set: { enabled: false }) { id } }`,
    `mutation { deleteTrigger { id } }`,
    `mutation { deleteMcpServer { id } }`,
  ]) {
    expect(await refused(source, "operator"), source).toEqual(["FORBIDDEN"]);
    expect(await refused(source, "agent"), source).toEqual(["FORBIDDEN"]);
  }
});

// A request nothing built a context for is this server executing its own schema — a test calling
// `graphql()`, or a tool running in process. That is the operator, not a stranger.
test("no context at all is the operator", async () => {
  expect(await refused(`{ settings { baseUrl } }`)).toEqual([]);
});

/**
 * Every tool an agent is offered is one an agent may actually reach.
 *
 * The listing and the lock are written apart on purpose — one is what to spend an agent's
 * context on, the other is what may be touched — and they fail in opposite directions when they
 * drift. A field added to `TOOLS` that the map denies is a tool that is advertised, called, and
 * refuses every time; the agent has no way to tell that from a server that is broken. This runs
 * each tool's rule rather than the field behind it, so nothing here writes a row or spawns a
 * process.
 */
test("the tool listing and the permissions map agree", async () => {
  const ruleFor = resolvePermissions(schema, permissions);
  const reached = Symbol("resolved");

  for (const path of TOOLS) {
    const [type, field] = path.split(".");
    const rule = ruleFor(type, field);
    if (!rule) continue;
    const info = { parentType: { name: type }, fieldName: field } as GraphQLResolveInfo;
    // A rule that allows the field calls the resolver it was handed; one that denies it throws,
    // and the refusal is what the assertion below reports under the tool's own name.
    const outcome = await Promise.resolve(
      rule(async () => reached, undefined, {}, { caller: "agent" }, info),
    ).catch((error: unknown) => error);
    expect(outcome, path).toBe(reached);
  }
});
