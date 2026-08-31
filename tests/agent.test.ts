import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Settings } from "../server/db/schema.ts";
import { replyWith } from "./fixtures/sse.ts";

// Loading the runner pulls in the database module, so give it somewhere disposable first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-agent-"));
process.env.TASK_SERVER_DATA_DIR = dir;

/** Chat completions the fake model server hands back, one per request, in order. */
let replies: ReturnType<typeof completion>[] = [];
let server: http.Server;
let baseUrl = "";

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
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

beforeAll(async () => {
  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const sent = JSON.parse(body);
      replyWith(response, replies.shift() ?? completion({ role: "assistant", content: "" }), sent);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const config = () =>
  ({
    id: "default",
    baseUrl,
    apiKey: "",
    model: "fake",
    systemPrompt: "",
    maxTokens: 256,
    temperature: 0,
    maxToolIterations: 3,
  }) as Settings;

const toolCall = (name: string, args = "{}") =>
  completion({
    role: "assistant",
    content: null,
    tool_calls: [{ id: "call-1", type: "function", function: { name, arguments: args } }],
  });

test("returns the reply and sums usage across turns", async () => {
  const { runAgent } = await import("../server/runner/agent.ts");
  replies = [toolCall("missing__tool"), completion({ role: "assistant", content: "done" })];

  const result = await runAgent({
    config: config(),
    model: "fake",
    systemPrompt: "be brief",
    prompt: "go",
  });

  expect(result.output).toBe("done");
  // No MCP server is connected, so the call fails — and a failed tool is recorded, not fatal:
  // the model gets the error back as the tool result and decides what to do with it.
  expect(result.toolCalls).toEqual([{ name: "missing__tool", ok: false }]);
  expect(result.totalTokens).toBe(30);
});

test("reports the run as it happens, tokens and tool calls alike", async () => {
  const { runAgent } = await import("../server/runner/agent.ts");
  replies = [toolCall("missing__tool"), completion({ role: "assistant", content: "all done" })];

  const events: { kind: string; text: string; name?: string; ok?: boolean | null }[] = [];
  await runAgent({
    config: config(),
    model: "fake",
    systemPrompt: "",
    prompt: "go",
    onEvent: (event) => events.push(event as (typeof events)[number]),
  });

  expect(events.filter((event) => event.kind === "step")).toHaveLength(2);
  // Content arrives in pieces and is reported as it does, not in one lump at the end.
  const output = events.filter((event) => event.kind === "output");
  expect(output.length).toBeGreaterThan(1);
  expect(output.map((event) => event.text).join("")).toBe("all done");
  expect(events.find((event) => event.kind === "tool-call")).toMatchObject({
    name: "missing__tool",
  });
  expect(events.find((event) => event.kind === "tool-result")).toMatchObject({ ok: false });
});

test("gives up once it has spent its tool iterations", async () => {
  const { runAgent } = await import("../server/runner/agent.ts");
  replies = [toolCall("missing__a"), toolCall("missing__b"), toolCall("missing__c")];

  await expect(
    runAgent({ config: config(), model: "fake", systemPrompt: "", prompt: "loop" }),
  ).rejects.toThrow(/3 tool iterations/);
});

test("refuses to run without a model", async () => {
  const { runAgent } = await import("../server/runner/agent.ts");
  await expect(
    runAgent({ config: config(), model: "", systemPrompt: "", prompt: "go" }),
  ).rejects.toThrow(/No model selected/);
});
