import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { McpServerRow, Settings } from "../server/db/schema.ts";
import { replyWith } from "./fixtures/sse.ts";

// Loading the runner pulls in the database module, so give it somewhere disposable first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-ondemand-"));
process.env.TASK_SERVER_DATA_DIR = dir;

/** Chat completions the fake model server hands back, one per request, in order. */
let replies: ReturnType<typeof completion>[] = [];
/** Every request body it was sent, so the tests can see what the tool array looked like. */
let sent: ChatRequest[] = [];
let server: http.Server;
let baseUrl = "";

interface ChatRequest {
  messages: { role: string; content: string }[];
  tools?: { function: { name: string; parameters?: unknown } }[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

const completion = (message: {
  role: string;
  content?: string | null;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
}) => ({
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 0,
  model: "fake",
  choices: [{ index: 0, message, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const text = (content: string) => completion({ role: "assistant", content });

const toolCall = (name: string, args = "{}", id = "call-1") =>
  completion({
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  });

beforeAll(async () => {
  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(body) as ChatRequest;
      sent.push(parsed);
      replyWith(response, replies.shift() ?? text(""), parsed);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;

  // One real stdio MCP server, so the catalogue and the tool calls are the genuine article.
  const { mcp } = await import("../server/runner/mcp.ts");
  await mcp.sync([
    {
      id: "echo-1",
      slug: "echo",
      label: "Echo",
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: [fileURLToPath(new URL("./fixtures/mcp-echo.mjs", import.meta.url))],
      env: null,
      url: "",
      headers: null,
    } satisfies McpServerRow,
  ]);
});

afterAll(async () => {
  const { mcp } = await import("../server/runner/mcp.ts");
  await mcp.shutdown();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const config = (over: Partial<Settings> = {}) =>
  ({
    id: "default",
    baseUrl,
    apiKey: "",
    model: "fake",
    systemPrompt: "",
    maxTokens: 256,
    temperature: 0,
    maxToolIterations: 5,
    toolDiscovery: "ondemand",
    toolSelectModel: "",
    ...over,
  }) as Settings;

const run = async (over: Partial<Settings> = {}) => {
  sent = [];
  const { runAgent } = await import("../server/runner/agent.ts");
  return runAgent({
    config: config(over),
    model: "fake",
    systemPrompt: "be brief",
    prompt: "say hello",
  });
};

const namesOf = (request: ChatRequest) => (request.tools ?? []).map((tool) => tool.function.name);

test("the pool exposes a name-only catalogue and filters definitions by name", async () => {
  const { mcp } = await import("../server/runner/mcp.ts");
  const catalog = mcp.catalog();
  expect(catalog).toHaveLength(1);
  expect(catalog[0].tools.map((tool) => tool.name)).toEqual([
    "echo__ping",
    "echo__echo",
    "echo__add",
  ]);
  const filtered = mcp
    .tools(["echo__add"])
    .flatMap((tool) => (tool.type === "function" ? [tool.function.name] : []));
  expect(filtered).toEqual(["echo__add"]);
});

test("on demand, only load_tools goes up front and the schemas follow", async () => {
  replies = [
    text("[]"), // preselection: nothing guessed, so the model works from the catalogue
    toolCall("load_tools", JSON.stringify({ names: ["echo__ping"] })),
    toolCall("echo__ping"),
    text("pong"),
  ];

  const result = await run();

  expect(result.output).toBe("pong");
  expect(result.toolCalls).toEqual([
    { name: "load_tools", ok: true },
    { name: "echo__ping", ok: true },
  ]);

  // The preselection call carries the catalogue as text and no tools at all.
  expect(sent[0].tools).toBeUndefined();
  expect(sent[0].messages[1].content).toContain("echo__ping");

  // First real step: the catalogue is in the system prompt, but no schema has been sent.
  expect(namesOf(sent[1])).toEqual(["load_tools"]);
  expect(sent[1].messages[0].content).toContain("# Tool catalogue");
  expect(sent[1].messages[0].content).toContain("  echo__add");

  // Second step: the one loaded schema, and the catalogue marks it so it is not loaded twice.
  expect(namesOf(sent[2]).sort()).toEqual(["echo__ping", "load_tools"]);
  expect(sent[2].messages[0].content).toContain("echo__ping (loaded)");
});

test("a preselection skips the catalogue for the first step", async () => {
  replies = [
    text('["echo__add"]'),
    toolCall("echo__add", JSON.stringify({ a: 1, b: 2 })),
    text("3"),
  ];

  const result = await run();

  expect(result.output).toBe("3");
  // Routed: the shortlist alone, no catalogue and no load_tools to distract with.
  expect(namesOf(sent[1])).toEqual(["echo__add"]);
  expect(sent[1].messages[0].content).toBe("be brief");
  // Everything comes back on the step after.
  expect(namesOf(sent[2]).sort()).toEqual(["echo__add", "load_tools"]);
});

test("a catalogued tool called without loading is run, not refused", async () => {
  replies = [text("[]"), toolCall("echo__echo", JSON.stringify({ text: "hi" })), text("said hi")];

  const result = await run();

  expect(result.toolCalls).toEqual([{ name: "echo__echo", ok: true }]);
  expect(result.output).toBe("said hi");
});

test("eager mode sends every schema and asks no one which tools to use", async () => {
  replies = [text("done")];

  const result = await run({ toolDiscovery: "eager" });

  expect(result.output).toBe("done");
  expect(sent).toHaveLength(1);
  expect(namesOf(sent[0]).sort()).toEqual(["echo__add", "echo__echo", "echo__ping"]);
  expect(sent[0].messages[0].content).toBe("be brief");
});
