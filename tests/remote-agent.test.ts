import type http from "node:http";
import {
  progressChunk,
  type RunEvent,
  type RunEventInput,
  RunEventKind,
} from "@cubicecho/agent-core";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { Settings } from "../server/db/schema.ts";
import { type ChatBody, completion, notChat, replyWith, sseFrom } from "./fixtures/sse.ts";
import { dataDir, echoRow, type FakeModel, fakeModel, settingsRow, useModel } from "./helpers.ts";

// The runner and the schema are built against the live tables at import time.
dataDir("remote-agent");

/** The router's own run, as its progress names it. */
const ROUTER_RUN = "router-run-1";

/** Every chat request the router was sent. */
let sent: ChatBody[] = [];
/** The reply each chat request gets, after the agent's progress. */
let replies: string[] = [];
let router: FakeModel;
/** A plain model server, standing in for the settings row's own endpoint. */
let plain: FakeModel;
/** What the plain server was asked, so a test can see a read-back arrive there. */
let plainSent: ChatBody[] = [];

/** One of the router's events, numbered as it numbers them. */
const event = (seq: number, over: Partial<RunEvent>): RunEvent => ({
  runId: ROUTER_RUN,
  seq,
  at: Date.now(),
  kind: RunEventKind.Notice,
  text: "",
  name: "",
  exchange: "",
  ok: null,
  usage: null,
  ...over,
});

/** The agent's work inside one request: a turn, and a call of its own to one of its servers. */
const progress = (): RunEvent[] => [
  event(1, { kind: RunEventKind.Turn, text: "turn 1" }),
  event(2, { kind: RunEventKind.Thinking, text: "checking the budget" }),
  event(3, { kind: RunEventKind.ToolCall, id: "own-1", name: "actual__balance", text: "{}" }),
  event(4, { kind: RunEventKind.ToolResult, id: "own-1", name: "actual__balance", ok: true }),
];

/** `GET /models`, as ai-router answers it: one agent, and one entry that is not marked. */
const listing: (request: http.IncomingMessage, response: http.ServerResponse) => boolean = (
  request,
  response,
) => {
  if (request.method === "GET" && request.url?.endsWith("/models")) {
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        object: "list",
        data: [
          { id: "personal-finance", object: "model", agent_core: { kind: "agent" } },
          { id: "unmarked", object: "model" },
        ],
      }),
    );
    return true;
  }
  return notChat(request, response);
};

beforeAll(async () => {
  router = await fakeModel((body, response) => {
    sent.push(body);
    const head = { id: "chatcmpl-router", created: 0, model: "personal-finance" };
    const chunks = progress()
      .map((each) => `data: ${JSON.stringify(progressChunk(each, head))}\n\n`)
      .join("");
    response.writeHead(200, { "content-type": "text/event-stream", "x-run-id": ROUTER_RUN });
    response.end(chunks + sseFrom(completion(replies.shift() ?? "done"), true));
  }, listing);
  plain = await fakeModel((body, response) => {
    plainSent.push(body);
    replyWith(response, completion('{"case": "clean"}'), body);
  });

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  // One real stdio MCP server, so a scope of none is visibly none rather than an empty pool.
  const { mcp } = await import("../server/runner/mcp.ts");
  await mcp.sync([echoRow()]);
});

afterAll(async () => {
  const { mcp } = await import("../server/runner/mcp.ts");
  await mcp.shutdown();
  await router.close();
  await plain.close();
});

beforeEach(async () => {
  sent = [];
  plainSent = [];
  replies = [];
  const { resetRemoteAgents } = await import("../server/runner/remote-agent.ts");
  resetRemoteAgents();
});

const onRouter = (over: Partial<Settings> = {}) =>
  settingsRow({
    baseUrl: router.baseUrl,
    toolDiscovery: "ondemand",
    toolSelectModel: "a-model-the-router-does-not-serve",
    compactionModel: "nor-this-one",
    maxTokens: 300,
    temperature: 0.4,
    ...over,
  });

async function runOn(config: Settings, servers?: ReadonlySet<string>) {
  const { runAgent } = await import("../server/runner/agent.ts");
  const events: RunEventInput[] = [];
  const result = await runAgent({
    config,
    model: "personal-finance",
    systemPrompt: "you run on a schedule",
    prompt: "what is due this week?",
    servers,
    onEvent: (each) => events.push(each),
  });
  return { result, events };
}

test("only a model the listing marks as an agent is one", async () => {
  const { isRemoteAgent } = await import("../server/runner/remote-agent.ts");
  const server = { baseUrl: router.baseUrl, apiKey: "" };
  expect(await isRemoteAgent(server, "personal-finance")).toBe(true);
  expect(await isRemoteAgent(server, "unmarked")).toBe(false);
  expect(await isRemoteAgent(server, "not-listed")).toBe(false);
  // A server with no listing is a plain one, and is asked again next time.
  expect(await isRemoteAgent({ baseUrl: plain.baseUrl, apiKey: "" }, "fake")).toBe(false);
});

test("a step on an agent is one request: no side task, no tool of the loop's own", async () => {
  const { result } = await runOn(onRouter());

  expect(result.output).toBe("done");
  expect(result.remote).toBe(true);
  // No preselection and no compaction were asked of a router that serves agents only.
  expect(sent).toHaveLength(1);
  // Unnarrowed, a step on an agent reaches no server of this one's: `load_tools` and every
  // `echo__` tool would be the app's tools to the agent, and the agent has servers of its own.
  expect((sent[0].tools ?? []).map((tool) => tool.function.name)).toEqual([]);
});

test("a step on an agent sends the sampling it was configured with, and the system prompt", async () => {
  await runOn(onRouter());
  const body = sent[0] as ChatBody & { temperature?: number; max_tokens?: number };
  expect(body.temperature).toBe(0.4);
  expect(body.max_tokens).toBe(300);
  expect(body.messages[0]).toEqual({ role: "system", content: "you run on a schedule" });
  // The agent's progress is asked for, under the field ai-router reads.
  expect((body as { agent_core?: unknown }).agent_core).toMatchObject({ progress: true });
});

test("a scope that names a server sends that server's tools as the app's", async () => {
  await runOn(onRouter(), new Set(["echo-1"]));
  const names = (sent[0].tools ?? []).map((tool) => tool.function.name);
  expect(names).toContain("echo__ping");
  // Eager whatever the setting says: the agent refuses `load_tools` as one of the app's.
  expect(names).not.toContain("load_tools");
});

test("the agent's own calls and its run id are kept, and its progress reaches the watcher", async () => {
  const { result, events } = await runOn(onRouter());

  expect(result.remoteRunId).toBe(ROUTER_RUN);
  expect(result.toolCalls).toEqual([{ name: "actual__balance", ok: true }]);
  const forwarded = events.filter((each) => "seq" in each);
  expect(forwarded.map((each) => each.kind)).toEqual(
    expect.arrayContaining(["turn", "thinking", "tool-call", "tool-result"]),
  );
});

test("a run on an agent profile reaches no server, records the router's run, and reads a decision back elsewhere", async () => {
  const client = await import("../server/db/client.ts");
  const tables = await import("../server/db/schema.ts");
  const runner = await import("../server/runner/run.ts");
  const { asc, eq } = await import("drizzle-orm");

  // The settings row is a plain model; the profile points the task at the router's agent.
  await useModel(plain);
  const [agent] = await client.db
    .insert(tables.agents)
    .values({ name: "finance", baseUrl: router.baseUrl, model: "personal-finance" })
    .returning();
  const [task] = await client.db
    .insert(tables.tasks)
    .values({ name: "friday", prompt: "what is due this week?", agentId: agent.id })
    .returning();
  await client.db.insert(tables.steps).values({
    taskId: task.id,
    name: "anything overdue?",
    kind: "decision",
    prompt: "is anything overdue?",
    cases: ["overdue", "clean"],
    position: 0,
  });
  replies = ["three bills", "nothing is late, as far as I can see"];

  const run = await runner.runTask(task.id);
  expect(run.status).toBe("ok");

  const rows = await client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, run.id))
    .orderBy(asc(tables.runSteps.position));
  expect(rows.map((row) => [row.name, row.branch, row.remoteRunId])).toEqual([
    ["friday", "", ROUTER_RUN],
    ["anything overdue?", "clean", ROUTER_RUN],
  ]);
  // Both steps went to the router with no tools, and the prose answer was read back on the
  // settings row's own endpoint, the one place there is a plain model to ask.
  expect(sent).toHaveLength(2);
  expect(sent.every((body) => (body.tools ?? []).length === 0)).toBe(true);
  expect(plainSent).toHaveLength(1);
  expect(plainSent[0].response_format).toBeDefined();
});
