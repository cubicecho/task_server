import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { Settings } from "../server/db/schema.ts";
import { sseFrom } from "./fixtures/sse.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-resilience-"));
process.env.TASK_SERVER_DATA_DIR = dir;

/** What the fake model server does with the next request, in order. */
type Reply =
  | { kind: "ok"; content: string }
  | { kind: "status"; code: number }
  /** Headers, some tokens, then nothing at all — the endpoint that stops mid-answer. */
  | { kind: "stall"; after: string }
  /** Accepted, then silent. Nothing is ever produced, so it is safe to retry. */
  | { kind: "silent" };

let replies: Reply[] = [];
let requests = 0;
let server: http.Server;
let baseUrl = "";
const open: http.ServerResponse[] = [];

const completion = (content: string) => ({
  id: "chatcmpl-test",
  model: "fake",
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

beforeAll(async () => {
  server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requests++;
      const reply = replies.shift() ?? { kind: "ok", content: "done" };
      if (reply.kind === "status") {
        response.writeHead(reply.code, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: `fake ${reply.code}` } }));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (reply.kind === "ok") {
        response.end(sseFrom(completion(reply.content), false));
        return;
      }
      // Held open and never ended: the socket is closed in afterEach.
      open.push(response);
      if (reply.kind === "stall") {
        response.write(
          `data: ${JSON.stringify({
            id: "x",
            object: "chat.completion.chunk",
            created: 0,
            model: "fake",
            choices: [{ index: 0, delta: { content: reply.after }, finish_reason: null }],
          })}\n\n`,
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;
});

beforeEach(() => {
  replies = [];
  requests = 0;
  while (open.length) open.pop()?.destroy();
});

afterAll(async () => {
  while (open.length) open.pop()?.destroy();
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
    maxToolIterations: 3,
    requestTimeoutSeconds: 0,
    maxRetries: 0,
    ...over,
  }) as Settings;

const run = async (over: Partial<Settings> = {}) => {
  const { runAgent } = await import("../server/runner/agent.ts");
  return runAgent({ config: config(over), model: "fake", systemPrompt: "", prompt: "go" });
};

test("a busy endpoint is waited out and the run still finishes", async () => {
  replies = [
    { kind: "status", code: 503 },
    { kind: "status", code: 429 },
    { kind: "ok", content: "recovered" },
  ];

  const result = await run({ maxRetries: 2 });
  expect(result.output).toBe("recovered");
  expect(requests).toBe(3);
});

test("retries are bounded, and the last failure is what the run reports", async () => {
  replies = [
    { kind: "status", code: 500 },
    { kind: "status", code: 500 },
    { kind: "status", code: 500 },
    { kind: "status", code: 500 },
  ];

  await expect(run({ maxRetries: 1 })).rejects.toThrow(/500/);
  // The first attempt plus one retry, and no more.
  expect(requests).toBe(2);
});

test("a complaint about the request itself is not retried", async () => {
  replies = [
    { kind: "status", code: 400 },
    { kind: "ok", content: "never reached" },
  ];

  await expect(run({ maxRetries: 3 })).rejects.toThrow();
  expect(requests).toBe(1);
});

test("an endpoint that accepts and then says nothing times out, and is retried", async () => {
  replies = [{ kind: "silent" }, { kind: "ok", content: "second time" }];

  const result = await run({ requestTimeoutSeconds: 1, maxRetries: 1 });
  expect(result.output).toBe("second time");
  expect(requests).toBe(2);
});

test("an endpoint that stalls mid-answer gives up rather than repeating itself", async () => {
  replies = [
    { kind: "stall", after: "half a th" },
    { kind: "ok", content: "unreachable" },
  ];

  // Tokens are already out and on their way to whoever is watching. Replaying the turn would
  // say them twice, so the timeout is fatal here where it was retryable above.
  await expect(run({ requestTimeoutSeconds: 1, maxRetries: 3 })).rejects.toThrow(/sent nothing/);
  expect(requests).toBe(1);
});
