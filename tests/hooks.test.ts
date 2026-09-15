import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolHook } from "@cubicecho/agent-mcp-pool";
import { type GraphQLSchema, graphql } from "graphql";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { replyWith } from "./fixtures/sse.ts";

/**
 * The MCP servers' hooks, fired around a real run against a real stdio server.
 *
 * What a hook does never shows up in a run's tool calls — the pool makes the call on the host's
 * behalf — so the fixture writes every call it receives to a log, and that log is what these
 * tests read. The model is a local HTTP server that records the user message of every request,
 * which is where injected context has to land.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-hooks-"));
process.env.TASK_SERVER_DATA_DIR = dir;

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-echo.mjs", import.meta.url));
const callLog = path.join(dir, "calls.log");

let replies: string[] = [];
let prompts: string[] = [];
let toolNames: string[][] = [];
let server: http.Server;

let client: typeof import("../server/db/client.ts");
let tables: typeof import("../server/db/schema.ts");
let runner: typeof import("../server/runner/run.ts");
let hooks: typeof import("../server/runner/hooks.ts");
let mcp: typeof import("../server/runner/mcp.ts")["mcp"];
let cron: typeof import("../server/scheduler/cron.ts");
let schema: GraphQLSchema;

const completion = (content: string) => ({
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 0,
  model: "fake",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

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
    args: [FIXTURE],
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
  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const sent = JSON.parse(body) as {
        messages: { role: string; content: string }[];
        tools?: { function: { name: string } }[];
        stream?: boolean;
      };
      prompts.push(sent.messages.find((message) => message.role === "user")?.content ?? "");
      toolNames.push((sent.tools ?? []).map((tool) => tool.function.name));
      replyWith(response, completion(replies.shift() ?? ""), sent);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  client = await import("../server/db/client.ts");
  tables = await import("../server/db/schema.ts");
  runner = await import("../server/runner/run.ts");
  hooks = await import("../server/runner/hooks.ts");
  ({ mcp } = await import("../server/runner/mcp.ts"));
  cron = await import("../server/scheduler/cron.ts");
  ({ schema } = await import("../server/graphql/schema.ts"));

  const { eq } = await import("drizzle-orm");
  await client.db
    .update(tables.settings)
    .set({ baseUrl: `http://127.0.0.1:${port}/v1`, model: "fake" })
    .where(eq(tables.settings.id, "default"));
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
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
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
    `mutation ($id: String!) { deleteRunSingle(where: { id: { eq: $id } }) { id } }`,
    { id: first.id },
  );
  expect(deleted.errors).toBeUndefined();
  const gone = await gql(
    `mutation ($id: String!) { deleteTaskSingle(where: { id: { eq: $id } }) { id } }`,
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
