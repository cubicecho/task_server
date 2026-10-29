import type http from "node:http";
import { configureEvents, history, resetEvents } from "@cubicecho/agent-core";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { type Completion, completion, notChat, replyWith, toolCall } from "./fixtures/sse.ts";
import { dataDir, ECHO_FIXTURE, type FakeModel, fakeModel, useModel } from "./helpers.ts";

/**
 * A finished run keeps a summary of what it did, made from the events the bus forgets a minute
 * later — against a real stdio MCP server, so the tool call it counts is one that happened.
 */

dataDir("run-metrics");

/** Replies in order; a number is a status the request is refused with instead. */
let replies: (Completion | number)[] = [];
let model: FakeModel;

/** The window `/models` reports for the fake model. */
const WINDOW = 1000;

function listing(request: http.IncomingMessage, response: http.ServerResponse) {
  if (!request.url?.endsWith("/models")) {
    return false;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ data: [{ id: "fake", context_length: WINDOW }] }));
  return true;
}

let client: typeof import("../server/db/client.ts");
let tables: typeof import("../server/db/schema.ts");
let runner: typeof import("../server/runner/run.ts");
let mcp: typeof import("../server/runner/mcp.ts")["mcp"];

beforeAll(async () => {
  model = await fakeModel(
    (body, response) => {
      const reply = replies.shift() ?? completion("");
      if (typeof reply === "number") {
        response.writeHead(reply, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: `fake ${reply}` } }));
        return;
      }
      replyWith(response, reply, body);
    },
    (request, response) => listing(request, response) || notChat(request, response),
  );
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  client = await import("../server/db/client.ts");
  tables = await import("../server/db/schema.ts");
  runner = await import("../server/runner/run.ts");
  ({ mcp } = await import("../server/runner/mcp.ts"));
  await useModel(model);
  await client.db.insert(tables.mcpServers).values({
    slug: "echo",
    label: "Echo",
    command: process.execPath,
    args: [ECHO_FIXTURE],
  });
  await mcp.sync();
});

beforeEach(() => {
  replies = [];
});

afterEach(() => resetEvents());

afterAll(async () => {
  await mcp.shutdown();
  await model.close();
});

async function task(name: string, prompt: string) {
  const [row] = await client.db.insert(tables.tasks).values({ name, prompt }).returning();
  return row;
}

test("a finished run has its metrics on the row", async () => {
  const { id } = await task("pinger", "ping the echo server");
  replies = [toolCall("echo__ping"), toolCall("echo__nope", "{}", "call-2"), completion("pong")];

  const run = await runner.runTask(id);
  expect(run.status).toBe("ok");

  const [row] = await client.db.select().from(tables.runs).where(eq(tables.runs.id, run.id));
  expect(row.metrics).toMatchObject({
    steps: 1,
    turns: 3,
    requests: 3,
    toolCalls: 2,
    toolErrors: { echo__nope: 1 },
    promptTokens: 30,
    completionTokens: 15,
    outcome: "answered",
    largestPrompt: 10,
    // Told the window `/models` gave the step's model.
    largestPromptShare: 10 / WINDOW,
  });
  expect(row.metrics?.wallMs).toBeGreaterThanOrEqual(0);
});

test("a run longer than the bus's backlog is still counted whole", async () => {
  // A backlog of a handful: every tool call but the last few is gone from the bus by the end.
  configureEvents({ maxEvents: 4, trimSlack: 1 });
  const { id } = await task("chatty", "ping five times");
  replies = [
    ...[1, 2, 3, 4, 5].map((n) => toolCall("echo__ping", "{}", `call-${n}`)),
    completion("done"),
  ];

  const run = await runner.runTask(id);
  expect(run.status).toBe("ok");
  expect(history(run.id).length).toBeLessThan(10);
  expect(run.metrics).toMatchObject({ turns: 6, toolCalls: 5, outcome: "answered" });
});

test("a failed run keeps what it did before it failed", async () => {
  const { id } = await task("broken", "ping, then fail");
  // A request refused outright, which is not retried.
  replies = [toolCall("echo__ping"), 400];

  const run = await runner.runTask(id);
  expect(run.status).toBe("error");
  expect(run.metrics).toMatchObject({ toolCalls: 1, outcome: "failed" });
});
