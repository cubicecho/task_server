import type OpenAI from "openai";
import { expect, test } from "vitest";
import { pruneWhenFilling } from "../server/runner/pruning.ts";

type Message = OpenAI.ChatCompletionMessageParam;

/** A question, then `results` call-and-answer pairs whose answers are `size` characters each. */
function transcript(results: number, size: number): Message[] {
  const messages: Message[] = [{ role: "user", content: "go" }];
  for (let at = 0; at < results; at++) {
    const id = `call_${at}`;
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [{ id, type: "function", function: { name: "read", arguments: "{}" } }],
    });
    messages.push({ role: "tool", tool_call_id: id, content: "x".repeat(size) });
  }
  return messages;
}

test("a transcript well inside its window is left alone", () => {
  // Ten 4k-character results are ~10k tokens of a 100k window.
  expect(pruneWhenFilling(transcript(10, 4_000), { limit: 100_000 })).toBeUndefined();
});

test("nothing is pruned where the endpoint reported no window", () => {
  expect(pruneWhenFilling(transcript(10, 40_000), { limit: 0 })).toBeUndefined();
});

test("a filling window clears every result but the latest five", () => {
  const messages = transcript(10, 4_000);
  const pruned = pruneWhenFilling(messages, { limit: 12_000 });

  expect(pruned?.cleared).toBe(5);
  expect(pruned?.tokens).toBeGreaterThan(4_000);
  const results = pruned?.messages.filter((message) => message.role === "tool") ?? [];
  expect(results.slice(0, 5).every((r) => String(r.content).startsWith("[result cleared"))).toBe(
    true,
  );
  expect(results.slice(5).every((r) => r.content === "x".repeat(4_000))).toBe(true);
  // The array handed in is the loop's, and is not written to.
  expect(messages[2]).toMatchObject({ content: "x".repeat(4_000) });
});

test("the last request's reported prompt counts even where the estimate is small", () => {
  const pruned = pruneWhenFilling(transcript(10, 400), { used: 3_000, limit: 3_200 });
  expect(pruned?.cleared).toBe(5);
});

test("a prune that wins back too little of the window is not worth the cache it costs", () => {
  // Five short-ish old results against a window far larger than they are, reported as full.
  expect(pruneWhenFilling(transcript(10, 400), { used: 95_000, limit: 100_000 })).toBeUndefined();
});
