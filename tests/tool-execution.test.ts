import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { Settings } from "../server/db/schema.ts";
import { type ChatBody, type Completion, completion, replyWith } from "./fixtures/sse.ts";
import { dataDir, echoRow, type FakeModel, fakeModel, settingsRow } from "./helpers.ts";

dataDir("tool-execution");

/** What the echo fixture writes as each timed call starts and ends. */
interface Mark {
  at: "start" | "end";
  name: string;
  tag: string;
}

const logs = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-timing-"));
const timingLog = path.join(logs, "timing.jsonl");
const INSTRUCTIONS = "Always look before you poke.";

let replies: Completion[] = [];
let sent: ChatBody[] = [];
let model: FakeModel;

beforeAll(async () => {
  model = await fakeModel((body, response) => {
    sent.push(body);
    replyWith(response, replies.shift() ?? completion(""), body);
  });

  // The same fixture twice, trusted and not: the only difference between the two is the row's
  // word for it, which is the whole of what `auto` reads.
  const env = {
    MCP_ECHO_TIMED: "1",
    MCP_ECHO_TIMING_LOG: timingLog,
    MCP_ECHO_INSTRUCTIONS: INSTRUCTIONS,
  };
  const { mcp } = await import("../server/runner/mcp.ts");
  await mcp.sync([
    echoRow({ id: "trusted-1", slug: "trusted", env, trustAnnotations: true }),
    echoRow({ id: "plain-1", slug: "plain", env }),
  ]);
});

afterAll(async () => {
  const { mcp } = await import("../server/runner/mcp.ts");
  await mcp.shutdown();
  await model.close();
  fs.rmSync(logs, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(timingLog, { force: true });
  sent = [];
});

/** One reply asking for every call at once, then an answer. */
const asking = (calls: [name: string, tag: string][]) => {
  replies = [
    completion({
      role: "assistant",
      content: null,
      tool_calls: calls.map(([name, tag], index) => ({
        id: `call-${index}`,
        type: "function",
        function: { name, arguments: JSON.stringify({ tag }) },
      })),
    }),
    completion("done"),
  ];
};

const run = async (over: Partial<Settings>) => {
  const { runAgent } = await import("../server/runner/agent.ts");
  const result = await runAgent({
    config: settingsRow({ baseUrl: model.baseUrl, ...over }),
    model: "fake",
    systemPrompt: "be brief",
    prompt: "go",
  });
  expect(result.output).toBe("done");
  return result;
};

const marks = (): Mark[] =>
  fs
    .readFileSync(timingLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

/** Where in the log a call started or ended, so overlaps can be read as an order. */
const at = (log: Mark[], when: Mark["at"], tag: string) =>
  log.findIndex((mark) => mark.at === when && mark.tag === tag);

test("auto runs a trusted server's reads together, and a write between them in order", async () => {
  asking([
    ["trusted__look", "a"],
    ["trusted__look", "b"],
    ["trusted__poke", "c"],
    ["trusted__look", "d"],
  ]);
  await run({ toolExecution: "auto" });

  const log = marks();
  // a and b overlap: each starts before the other ends.
  expect(at(log, "start", "b")).toBeLessThan(at(log, "end", "a"));
  expect(at(log, "start", "a")).toBeLessThan(at(log, "end", "b"));
  // The write waits for both reads asked before it, and the read asked after waits for it.
  expect(at(log, "start", "c")).toBeGreaterThan(Math.max(at(log, "end", "a"), at(log, "end", "b")));
  expect(at(log, "start", "d")).toBeGreaterThan(at(log, "end", "c"));
});

test("a server with trustAnnotations off stays sequential under auto", async () => {
  asking([
    ["plain__look", "a"],
    ["plain__look", "b"],
    ["plain__look", "c"],
  ]);
  await run({ toolExecution: "auto" });

  const log = marks();
  expect(log.map((mark) => `${mark.at} ${mark.tag}`)).toEqual([
    "start a",
    "end a",
    "start b",
    "end b",
    "start c",
    "end c",
  ]);
});

test("sequential runs even a trusted server's reads one at a time", async () => {
  asking([
    ["trusted__look", "a"],
    ["trusted__look", "b"],
  ]);
  await run({ toolExecution: "sequential" });

  expect(marks().map((mark) => `${mark.at} ${mark.tag}`)).toEqual([
    "start a",
    "end a",
    "start b",
    "end b",
  ]);
});

// A trusted read asked twice in one reply is one question; anything else asked twice is two
// calls, because a counter or a "next page" is meant to answer differently the second time.
test("an identical repeat is answered once only for a trusted read", async () => {
  asking([
    ["trusted__look", "same"],
    ["trusted__look", "same"],
    ["plain__look", "again"],
    ["plain__look", "again"],
    ["trusted__poke", "twice"],
    ["trusted__poke", "twice"],
  ]);
  const result = await run({ toolExecution: "auto" });

  const started = marks().filter((mark) => mark.at === "start");
  expect(started.map((mark) => mark.tag)).toEqual(["same", "again", "again", "twice", "twice"]);
  // The model is still answered for every call it made.
  expect(result.toolCalls).toHaveLength(6);
});

/** The system message the first request of the last run was sent. */
const system = () => sent[0]?.messages.find((message) => message.role === "system")?.content;

test("the servers' own instructions reach the system prompt unless turned off", async () => {
  replies = [completion("done")];
  await run({ serverInstructions: true });
  expect(system()).toContain(INSTRUCTIONS);

  sent = [];
  replies = [completion("done")];
  await run({ serverInstructions: false });
  expect(system()).not.toContain(INSTRUCTIONS);
});
