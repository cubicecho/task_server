import { resetClients } from "@cubicecho/agent-core";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { Settings } from "../server/db/schema.ts";
import { dataDir, type FakeModel, fakeModel, settingsRow } from "./helpers.ts";

dataDir("reasoning-replay");

/** The assistant message a request replays, as far as these tests read it. */
interface Replayed {
  role: string;
  reasoning_content?: string;
  tool_calls?: unknown[];
}

let sent: Replayed[][] = [];
let model: FakeModel;

const frame = (delta: unknown, finish: string | null = null) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "fake",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;

/**
 * The first turn thinks out loud and calls a tool, the way a thinking model streams it — the
 * scratchpad in `reasoning_content` ahead of the call. The second answers. What matters is what
 * the second request is sent back.
 */
beforeAll(async () => {
  model = await fakeModel((body, response) => {
    sent.push(body.messages as Replayed[]);
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (sent.length === 1) {
      response.end(
        frame({ role: "assistant" }) +
          frame({ reasoning_content: "I should look first." }) +
          frame({
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                type: "function",
                function: { name: "missing__tool", arguments: "{}" },
              },
            ],
          }) +
          frame({}, "tool_calls") +
          "data: [DONE]\n\n",
      );
      return;
    }
    response.end(
      `${frame({ role: "assistant" })}${frame({ content: "done" }, "stop")}data: [DONE]\n\n`,
    );
  });
});

beforeEach(() => {
  // A refusal of the field would latch on the endpoint, and every test here shares one.
  resetClients();
  sent = [];
});

afterAll(async () => {
  await model.close();
});

const replayed = async (reasoningReplay: Settings["reasoningReplay"]) => {
  const { runAgent } = await import("../server/runner/agent.ts");
  const result = await runAgent({
    config: settingsRow({ baseUrl: model.baseUrl, reasoningReplay }),
    model: "fake",
    systemPrompt: "",
    prompt: "go",
  });
  expect(result.output).toBe("done");
  expect(sent).toHaveLength(2);
  return sent[1].find((message) => message.role === "assistant" && message.tool_calls?.length);
};

test("the default sends a thinking model's reasoning back with the call it led to", async () => {
  expect((await replayed("all"))?.reasoning_content).toBe("I should look first.");
});

test("tool_loop reaches agent-core as its own word, and still replays inside the tool loop", async () => {
  expect((await replayed("tool_loop"))?.reasoning_content).toBe("I should look first.");
});

test("none keeps the reasoning out of the transcript the endpoint is sent", async () => {
  const message = await replayed("none");
  expect(message).toBeDefined();
  expect(message?.reasoning_content).toBeUndefined();
});
