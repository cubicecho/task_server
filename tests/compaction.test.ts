import fs from "node:fs";
import path from "node:path";
import { resetEvents } from "@cubicecho/agent-core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type ChatBody, completion, notChat, replyWith, toolCall } from "./fixtures/sse.ts";
import { dataDir, ECHO_FIXTURE, type FakeModel, fakeModel, useModel } from "./helpers.ts";

/**
 * A step that outgrows its window is folded, not failed: one question and a long tool loop, which
 * is every step here and which agent-core could not fold before 4.5. Driven end to end — a real
 * run, a real stdio server whose `beforeCompact` hook is logged, and a model that reports a window
 * and prompt sizes that grow with what it is sent.
 */

const dir = dataDir("compaction");
const callLog = path.join(dir, "calls.log");

/** The window `/models` reports. Each tool round trip below is about a fifth of it. */
const WINDOW = 4000;

/** What the tool calls carry, and what the echo server hands back: ~400 tokens each way. */
const BULK = "x".repeat(1600);

const SUMMARY = "Notes: echoed the bulk text four times.";

let model: FakeModel;
const mainRequests: ChatBody[] = [];
const summaryRequests: ChatBody[] = [];

let client: typeof import("../server/db/client.ts");
let tables: typeof import("../server/db/schema.ts");
let runner: typeof import("../server/runner/run.ts");
let hooks: typeof import("../server/runner/hooks.ts");
let mcp: typeof import("../server/runner/mcp.ts")["mcp"];

const calls = (): { name: string }[] =>
  fs.existsSync(callLog)
    ? fs
        .readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

/** A prompt size the planner can trust: what was sent, at four characters a token. */
const sized = (body: ChatBody, reply: ReturnType<typeof completion>) => {
  const prompt = Math.ceil(JSON.stringify(body.messages).length / 4);
  return {
    ...reply,
    usage: { prompt_tokens: prompt, completion_tokens: 5, total_tokens: prompt + 5 },
  };
};

beforeAll(async () => {
  model = await fakeModel(
    (body, response) => {
      if ((body as ChatBody & { model?: string }).model === "summariser") {
        summaryRequests.push(body);
        replyWith(response, completion(SUMMARY), body);
        return;
      }
      mainRequests.push(body);
      const n = mainRequests.length;
      const reply =
        n <= 6
          ? toolCall("echo__echo", JSON.stringify({ text: BULK }), `call-${n}`)
          : completion("done");
      replyWith(response, sized(body, reply), body);
    },
    (request, response) => {
      if (request.url?.endsWith("/models")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "fake", context_length: WINDOW }] }));
        return true;
      }
      return notChat(request, response);
    },
  );

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  client = await import("../server/db/client.ts");
  tables = await import("../server/db/schema.ts");
  runner = await import("../server/runner/run.ts");
  hooks = await import("../server/runner/hooks.ts");
  ({ mcp } = await import("../server/runner/mcp.ts"));
  await useModel(model);
  await client.db
    .update(tables.settings)
    .set({ compactionModel: "summariser", maxToolIterations: 20 })
    .where(eq(tables.settings.id, "default"));

  await client.db.insert(tables.mcpServers).values({
    slug: "echo",
    label: "Echo",
    command: process.execPath,
    args: [ECHO_FIXTURE],
    env: { MCP_ECHO_CALL_LOG: callLog },
    hooks: [
      { id: "fold", on: "beforeCompact", tool: "ping" },
      { id: "after", on: "afterTurn", tool: "add", args: { a: 1, b: 2 } },
    ],
  });
  await mcp.sync();
});

afterAll(async () => {
  resetEvents();
  await mcp.shutdown();
  await model.close();
});

test("a single question's tool loop is folded once it fills the window, and beforeCompact fires", async () => {
  const [task] = await client.db
    .insert(tables.tasks)
    .values({ name: "bulk", prompt: "echo the bulk text until told to stop" })
    .returning();

  const run = await runner.runTask(task.id);
  await hooks.hooksSettled();
  expect(run.status, run.error ?? "").toBe("ok");
  expect(run.output).toBe("done");

  // The summary was written by the compaction model, and asked for once.
  expect(summaryRequests).toHaveLength(1);

  // What was sent after the fold opens with the summary and still carries the question.
  const last = mainRequests.at(-1);
  const sent = JSON.stringify(last?.messages);
  expect(sent).toContain(SUMMARY);
  expect(last?.messages.some((m) => m.role === "user" && m.content.includes("echo the bulk"))).toBe(
    true,
  );
  expect(last?.messages.filter((m) => m.role === "tool").length).toBeLessThan(6);

  // The hook ran once, through the loop, and nothing it did failed. `afterTurn` is still fired by
  // `hooks.ts` alone: handing the loop the hooks must not have it fire a second time.
  expect(calls().filter((call) => call.name === "ping")).toHaveLength(1);
  expect(calls().filter((call) => call.name === "add")).toHaveLength(1);
  const [step] = await client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, run.id));
  expect(step.hooks).toBeNull();
});
