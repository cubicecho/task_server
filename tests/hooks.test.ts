import fs from "node:fs";
import path from "node:path";
import type { ToolHook } from "@cubicecho/agent-mcp-pool";
import { type GraphQLSchema, graphql } from "graphql";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { completion, replyWith, userPrompt } from "./fixtures/sse.ts";
import { dataDir, ECHO_FIXTURE, type FakeModel, fakeModel, until, useModel } from "./helpers.ts";

/**
 * The MCP servers' hooks, fired around a real run against a real stdio server.
 *
 * What a hook does never shows up in a run's tool calls — the pool makes the call on the host's
 * behalf — so the fixture writes every call it receives to a log, and that log is what these
 * tests read. The model is a local HTTP server that records the user message of every request,
 * which is where injected context has to land.
 */

const dir = dataDir("hooks");

const callLog = path.join(dir, "calls.log");

let replies: string[] = [];
let prompts: string[] = [];
let toolNames: string[][] = [];
let model: FakeModel;

let client: typeof import("../server/db/client.ts");
let tables: typeof import("../server/db/schema.ts");
let runner: typeof import("../server/runner/run.ts");
let hooks: typeof import("../server/runner/hooks.ts");
let mcp: typeof import("../server/runner/mcp.ts")["mcp"];
let cron: typeof import("../server/scheduler/cron.ts");
let schema: GraphQLSchema;

/** Every call the fixture received, in order. */
const calls = (): { name: string; arguments: Record<string, unknown> }[] =>
  fs.existsSync(callLog)
    ? fs
        .readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

/** Configures the echo server with these hooks and hidden tools, and waits for it to connect. */
async function echoServer(rowHooks: ToolHook[], hiddenTools: string[] = []) {
  await client.db.insert(tables.mcpServers).values({
    slug: "echo",
    label: "Echo",
    command: process.execPath,
    args: [ECHO_FIXTURE],
    env: { MCP_ECHO_CALL_LOG: callLog },
    hooks: rowHooks,
    hiddenTools,
  });
  await mcp.sync();
}

async function task(name: string, prompt: string) {
  const [row] = await client.db.insert(tables.tasks).values({ name, prompt }).returning();
  return row;
}

async function gql(source: string, variableValues?: Record<string, unknown>) {
  return graphql({ schema, source, variableValues });
}

beforeAll(async () => {
  model = await fakeModel((body, response) => {
    prompts.push(userPrompt(body));
    toolNames.push((body.tools ?? []).map((tool) => tool.function.name));
    replyWith(response, completion(replies.shift() ?? ""), body);
  });

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  client = await import("../server/db/client.ts");
  tables = await import("../server/db/schema.ts");
  runner = await import("../server/runner/run.ts");
  hooks = await import("../server/runner/hooks.ts");
  ({ mcp } = await import("../server/runner/mcp.ts"));
  cron = await import("../server/scheduler/cron.ts");
  ({ schema } = await import("../server/graphql/schema.ts"));
  await useModel(model);
});

beforeEach(() => {
  replies = [];
  prompts = [];
  toolNames = [];
});

afterEach(async () => {
  await hooks.hooksSettled();
  await mcp.shutdown();
  await client.db.delete(tables.mcpServers);
  await client.db.delete(tables.tasks);
  fs.rmSync(callLog, { force: true });
});

afterAll(async () => {
  cron.stop();
  await model.close();
});

test("a beforeTurn hook's result is put in front of each step's prompt, and noted", async () => {
  await echoServer([
    {
      id: "recall",
      on: "beforeTurn",
      tool: "echo",
      args: { text: "memories of {{vars.task.name}} step {{turn.index}}" },
      inject: true,
    },
  ]);
  const { id: taskId } = await task("digest", "list the subjects");
  await client.db
    .insert(tables.steps)
    .values({ taskId, name: "write", prompt: "write them down", position: 0 });
  replies = ["one subject", "written"];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");

  expect(prompts[0]).toContain('<context source="Echo"');
  expect(prompts[0]).toContain("memories of digest step 0");
  // Said in this server's words, not the library's: agent-core's own preface names a user, and
  // nobody is here.
  expect(prompts[0].startsWith(hooks.HOOK_PREFACE)).toBe(true);
  // The prompt still ends the message: context goes ahead of it, never in place of it.
  expect(prompts[0].endsWith("list the subjects")).toBe(true);
  expect(prompts[1]).toContain("memories of digest step 1");

  const { asc, eq } = await import("drizzle-orm");
  const rows = await client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, run.id))
    .orderBy(asc(tables.runSteps.position));
  expect(rows[0].hooks).toMatchObject([
    {
      event: "beforeTurn",
      source: "Echo",
      hookId: "recall",
      text: expect.stringContaining("step 0"),
    },
  ]);
  // The step's own output is untouched by what was injected into its input.
  expect(rows[0].output).toBe("one subject");
});

test("afterTurn, sessionStart and sessionEnd reach the server with what the run did", async () => {
  await echoServer(
    [
      { id: "start", on: "sessionStart", tool: "add", args: { a: 1, b: 2 } },
      {
        id: "remember",
        on: "afterTurn",
        tool: "echo",
        args: { text: "{{vars.task.id}}|{{session.id}}|{{turn.messages}}" },
      },
      // A string, not `add`'s `b`: the pool checks arguments against the tool's schema, and
      // `"ok"` is not a number it could coerce.
      { id: "end", on: "sessionEnd", tool: "echo", args: { text: "{{status}}" } },
    ],
    ["add"],
  );
  const { id: taskId } = await task("digest", "list the subjects");
  replies = ["one subject"];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");
  await hooks.hooksSettled();

  const log = calls();
  expect(log.map((call) => call.name)).toEqual(["add", "echo", "echo"]);
  // `add` is hidden from the model and still callable by the row's own hook.
  expect(log[0].arguments).toEqual({ a: 1, b: 2 });
  const remembered = String(log[1].arguments.text);
  expect(remembered).toContain(`${taskId}|${run.id}|`);
  expect(remembered).toContain("list the subjects");
  expect(remembered).toContain("one subject");
  expect(log[2].arguments).toEqual({ text: "ok" });
  expect(toolNames[0]).not.toContain("echo__add");
  expect(toolNames[0]).toContain("echo__echo");
});

test("a hook that cannot run is noted on the step and never fails the run", async () => {
  await echoServer([
    { id: "keyed", on: "beforeTurn", tool: "echo", args: { text: "{{vars.nothing}}" } },
    { id: "gone", on: "afterTurn", tool: "no-such-tool", args: {} },
  ]);
  const { id: taskId } = await task("digest", "list the subjects");
  replies = ["one subject"];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");
  await hooks.hooksSettled();

  const { eq } = await import("drizzle-orm");
  const [row] = await client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, run.id));
  expect(row.hooks).toMatchObject([
    { event: "beforeTurn", hookId: "keyed", error: expect.stringContaining("vars.nothing") },
    { event: "afterTurn", hookId: "gone", error: expect.any(String) },
  ]);
});

test("deleting a run, or the task it belongs to, sends sessionDelete for each run", async () => {
  await echoServer([
    { id: "forget", on: "sessionDelete", tool: "echo", args: { text: "{{session.id}}" } },
  ]);
  const { id: taskId } = await task("digest", "p");
  replies = ["a", "b", "c"];
  const first = await runner.runTask(taskId);
  const second = await runner.runTask(taskId);
  const third = await runner.runTask(taskId);
  await hooks.hooksSettled();

  const deleted = await gql(
    `mutation ($id: String!) { deleteRun(where: { id: { eq: $id } }) { id } }`,
    { id: first.id },
  );
  expect(deleted.errors).toBeUndefined();
  const gone = await gql(
    `mutation ($id: String!) { deleteTask(where: { id: { eq: $id } }) { id } }`,
    { id: taskId },
  );
  expect(gone.errors).toBeUndefined();

  // Not awaited by the mutation, so give the calls a moment to land.
  for (let attempt = 0; attempt < 40 && calls().length < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(calls().map((call) => call.arguments.text)).toEqual(
    expect.arrayContaining([first.id, second.id, third.id]),
  );
  expect(calls()).toHaveLength(3);
});

test("a run removed by retention sends sessionDelete, like one deleted by hand", async () => {
  await echoServer([
    { id: "forget", on: "sessionDelete", tool: "echo", args: { text: "{{session.id}}" } },
  ]);
  const { id: taskId } = await task("old", "p");
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const [old] = await client.db
    .insert(tables.runs)
    .values({ taskId, status: "ok", startedAt: yearAgo })
    .returning();
  const [recent] = await client.db.insert(tables.runs).values({ taskId, status: "ok" }).returning();

  const { eq } = await import("drizzle-orm");
  const retention = (runRetentionDays: number) =>
    client.db
      .update(tables.settings)
      .set({ runRetentionDays })
      .where(eq(tables.settings.id, "default"));
  const { prune } = await import("../server/scheduler/cleanup.ts");
  await retention(30);
  try {
    expect(await prune()).toBe(1);
  } finally {
    await retention(0);
  }

  await until(() => calls().length > 0);
  await hooks.hooksSettled();
  // The run inside the window is still a session, and is not told otherwise.
  expect(calls().map((call) => call.arguments.text)).toEqual([old.id]);
  expect(recent.id).not.toBe(old.id);
});

test("hooks that could never run are refused when the row is saved", async () => {
  const create = (hooksValue: unknown, hiddenTools: unknown = null) =>
    gql(`mutation ($values: CreateMcpServerInput!) { createMcpServer(values: $values) { id } }`, {
      values: { slug: "bad", command: "true", hooks: hooksValue, hiddenTools },
    });

  const noReply = await create([
    { id: "early", on: "beforeTurn", tool: "echo", args: { text: "{{reply}}" } },
  ]);
  expect(noReply.errors?.[0]?.message).toContain("reply");

  const compact = await create([{ id: "c", on: "beforeCompact", tool: "echo" }]);
  expect(compact.errors?.[0]?.message).toContain("never compacts");

  const hidden = await create(null, "add");
  expect(hidden.errors?.[0]?.message).toContain("hiddenTools");

  const fine = await create(
    [{ id: "ok", on: "afterTurn", tool: "echo", args: { text: "{{reply}}" } }],
    ["add"],
  );
  expect(fine.errors).toBeUndefined();
});

test("a save is refused for what it gets wrong, and not for what the row already had wrong", async () => {
  const create = (values: Record<string, unknown>) =>
    gql(`mutation ($values: CreateMcpServerInput!) { createMcpServer(values: $values) { id } }`, {
      values,
    });
  const update = (id: string, set: Record<string, unknown>) =>
    gql(
      `mutation ($id: String!, $set: UpdateMcpServerInput!) {
        updateMcpServer(where: { id: { eq: $id } }, set: $set) { id }
      }`,
      { id, set },
    );

  expect((await create({ slug: "nothing" })).errors?.[0]?.message).toContain("needs a command");
  const ftp = await create({ slug: "ftp", transport: "http", url: "ftp://example.com" });
  expect(ftp.errors?.[0]?.message).toContain("not an http or https url");

  // A row from before the rule, written past the API as an older version would have left it.
  await client.db.insert(tables.mcpServers).values({ id: "old", slug: "old", command: "" });
  expect((await update("old", { enabled: false })).errors).toBeUndefined();
  expect((await update("old", { command: "true" })).errors).toBeUndefined();

  // An update is judged on the row it lands on: this one is stdio, so a url is not looked at,
  // and turning it into an http server with no url is the mistake.
  const turned = await update("old", { transport: "http" });
  expect(turned.errors?.[0]?.message).toContain("needs a url");
  expect((await update("old", { command: " " })).errors?.[0]?.message).toContain("needs a command");
});
