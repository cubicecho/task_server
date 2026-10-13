import { afterAll, beforeAll, expect, test } from "vitest";
import { type Completion, completion, replyWith, toolCall } from "./fixtures/sse.ts";
import { dataDir, type FakeModel, fakeModel, settingsRow } from "./helpers.ts";

// Loading the runner pulls in the database module, so give it somewhere disposable first.
dataDir("agent");

/** Chat completions the fake model server hands back, one per request, in order. */
let replies: Completion[] = [];
let model: FakeModel;

beforeAll(async () => {
  model = await fakeModel((body, response) =>
    replyWith(response, replies.shift() ?? completion(""), body),
  );
});

afterAll(async () => {
  await model.close();
});

const config = () => settingsRow({ baseUrl: model.baseUrl });

test("returns the reply and sums usage across turns", async () => {
  const { runAgent } = await import("../server/runner/agent.ts");
  replies = [toolCall("missing__tool"), completion("done")];

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
  replies = [toolCall("missing__tool"), completion("all done")];

  const events: { kind: string; text: string; name?: string; ok?: boolean | null }[] = [];
  await runAgent({
    config: config(),
    model: "fake",
    systemPrompt: "",
    prompt: "go",
    onEvent: (event) => events.push(event as (typeof events)[number]),
  });

  expect(events.filter((event) => event.kind === "turn")).toHaveLength(2);
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
