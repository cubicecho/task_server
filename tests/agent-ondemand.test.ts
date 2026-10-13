import type { RunEventInput } from "@cubicecho/agent-core";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Settings } from "../server/db/schema.ts";
import { type ChatBody, type Completion, completion, replyWith, toolCall } from "./fixtures/sse.ts";
import { dataDir, echoRow, type FakeModel, fakeModel, settingsRow } from "./helpers.ts";

// Loading the runner pulls in the database module, so give it somewhere disposable first.
dataDir("ondemand");

/** Chat completions the fake model server hands back, one per request, in order. */
let replies: Completion[] = [];
/** Every request body it was sent, so the tests can see what the tool array looked like. */
let sent: ChatBody[] = [];
let model: FakeModel;

beforeAll(async () => {
  model = await fakeModel((body, response) => {
    sent.push(body);
    replyWith(response, replies.shift() ?? completion(""), body);
  });

  // One real stdio MCP server, so the catalogue and the tool calls are the genuine article.
  const { mcp } = await import("../server/runner/mcp.ts");
  await mcp.sync([echoRow()]);
});

afterAll(async () => {
  const { mcp } = await import("../server/runner/mcp.ts");
  await mcp.shutdown();
  await model.close();
});

const config = (over: Partial<Settings> = {}) =>
  settingsRow({
    baseUrl: model.baseUrl,
    maxToolIterations: 5,
    toolDiscovery: "ondemand",
    ...over,
  });

/** What the last run told its watcher, in order. */
let events: RunEventInput[] = [];

const run = async (over: Partial<Settings> = {}) => {
  sent = [];
  events = [];
  const { runAgent } = await import("../server/runner/agent.ts");
  return runAgent({
    config: config(over),
    model: "fake",
    systemPrompt: "be brief",
    prompt: "say hello",
    onEvent: (event) => events.push(event),
  });
};

const namesOf = (request: ChatBody) => (request.tools ?? []).map((tool) => tool.function.name);

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
    .tools({ names: ["echo__add"] })
    .flatMap((tool) => (tool.type === "function" ? [tool.function.name] : []));
  expect(filtered).toEqual(["echo__add"]);
});

test("on demand, only load_tools goes up front and the schemas follow", async () => {
  replies = [
    completion("[]"), // preselection: nothing guessed, so the model works from the catalogue
    toolCall("load_tools", JSON.stringify({ names: ["echo__ping"] })),
    toolCall("echo__ping"),
    completion("pong"),
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

  // Second step: the one loaded schema. The system prompt is the same text as before the load,
  // so loading a tool does not cost the endpoint its cache of everything after it.
  expect(namesOf(sent[2]).sort()).toEqual(["echo__ping", "load_tools"]);
  expect(sent[2].messages[0].content).toBe(sent[1].messages[0].content);
});

test("a preselection skips the catalogue for the first step", async () => {
  replies = [
    completion('["echo__add"]'),
    toolCall("echo__add", JSON.stringify({ a: 1, b: 2 })),
    completion("3"),
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
  replies = [
    completion("[]"),
    toolCall("echo__echo", JSON.stringify({ text: "hi" })),
    completion("said hi"),
  ];

  const result = await run();

  expect(result.toolCalls).toEqual([{ name: "echo__echo", ok: true }]);
  expect(result.output).toBe("said hi");
});

test("a call the model wrote out as text is run, not handed back as the answer", async () => {
  const written = JSON.stringify({ name: "echo__echo", arguments: { text: "hi" } });
  replies = [completion(`<tool_call>\n${written}\n</tool_call>`), completion("said hi")];

  const result = await run({ toolDiscovery: "eager" });

  expect(result.toolCalls).toEqual([{ name: "echo__echo", ok: true }]);
  expect(result.output).toBe("said hi");
});

test("eager mode sends every schema and asks no one which tools to use", async () => {
  replies = [completion("done")];

  const result = await run({ toolDiscovery: "eager" });

  expect(result.output).toBe("done");
  expect(sent).toHaveLength(1);
  expect(namesOf(sent[0]).sort()).toEqual(["echo__add", "echo__echo", "echo__ping"]);
  expect(sent[0].messages[0].content).toBe("be brief");
});

test("a run tells its watcher each turn, call and result, in order and in these words", async () => {
  replies = [
    completion('["echo__add"]'),
    toolCall("echo__add", JSON.stringify({ a: 1, b: 2 })),
    toolCall("load_tools", JSON.stringify({ names: ["echo__ping", "echo__nope"] }), "call-2"),
    toolCall("echo__ping", "{}", "call-3"),
    completion("3, and pong"),
  ];

  const result = await run();

  expect(result.output).toBe("3, and pong");
  expect(result.toolCalls).toEqual([
    { name: "echo__add", ok: true },
    { name: "load_tools", ok: true },
    { name: "echo__ping", ok: true },
  ]);
  // Token counts are a second stream beside this one, and how an answer is cut into deltas is the
  // endpoint's business, so neither is part of what is held here.
  const told = events
    .filter((event) => event.kind !== "usage" && event.kind !== "output")
    .map(({ kind, name, ok, text }) => [kind, name, ok, text].filter((part) => part !== undefined));
  expect(told).toEqual([
    ["notice", "tools picked before the run: echo__add"],
    ["turn", "turn 1"],
    ["tool-call", "echo__add", '{"a":1,"b":2}'],
    ["tool-result", "echo__add", true, 'add({"a":1,"b":2})'],
    ["turn", "turn 2"],
    ["tool-call", "load_tools", '{"names":["echo__ping","echo__nope"]}'],
    [
      "tool-result",
      "load_tools",
      true,
      "Loaded 1 tool(s); they are callable on your next step.\n\n" +
        "echo__ping: replies pong\n\n" +
        "Not in the catalogue: echo__nope. Check the names and try again.",
    ],
    ["turn", "turn 3"],
    ["tool-call", "echo__ping", "{}"],
    ["tool-result", "echo__ping", true, "ping({})"],
    ["turn", "turn 4"],
  ]);
  const answer = events.flatMap((event) => (event.kind === "output" ? [event.text] : []));
  expect(answer.join("")).toBe("3, and pong");
});
