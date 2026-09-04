import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { replyWith } from "./fixtures/sse.ts";

// The schema and the runner are built against the live tables at import time, so the database
// has to be pointed somewhere disposable before anything under server/ is loaded.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-flow-run-"));
process.env.TASK_SERVER_DATA_DIR = dir;

/** Replies the fake model server hands back, one per request, in order. */
let replies: string[] = [];
/** The user message of every request it received, so a test can see what a step was shown. */
let prompts: string[] = [];
/** Requests to leave unanswered, so a run can be caught mid-flow and stopped. */
let hangAfter = Number.POSITIVE_INFINITY;
let received = 0;
let server: http.Server;

let client: typeof import("../server/db/client.ts");
let tables: typeof import("../server/db/schema.ts");
let runner: typeof import("../server/runner/run.ts");
let cron: typeof import("../server/scheduler/cron.ts");

const completion = (content: string) => ({
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 0,
  model: "fake",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

beforeAll(async () => {
  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const sent = JSON.parse(body) as {
        messages: { role: string; content: string }[];
        stream?: boolean;
      };
      prompts.push(sent.messages.find((message) => message.role === "user")?.content ?? "");
      // Accepted and never answered: the run stays in flight until it is stopped.
      if (++received > hangAfter) return;
      replyWith(response, completion(replies.shift() ?? ""), sent);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  client = await import("../server/db/client.ts");
  tables = await import("../server/db/schema.ts");
  runner = await import("../server/runner/run.ts");
  cron = await import("../server/scheduler/cron.ts");

  const { eq } = await import("drizzle-orm");
  await client.db
    .update(tables.settings)
    .set({ baseUrl: `http://127.0.0.1:${port}/v1`, model: "fake" })
    .where(eq(tables.settings.id, "default"));
});

afterAll(async () => {
  cron.stop();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  replies = [];
  prompts = [];
  hangAfter = Number.POSITIVE_INFINITY;
  received = 0;
});

/** A task with its own prompt, plus whatever steps hang off it. */
async function task(name: string, prompt: string) {
  const [row] = await client.db.insert(tables.tasks).values({ name, prompt }).returning();
  return row;
}

const addStep = async (values: Partial<typeof tables.steps.$inferInsert> & { taskId: string }) => {
  const [row] = await client.db.insert(tables.steps).values(values).returning();
  return row;
};

/** The run's own account of what it did, in the order it did it. */
async function stepsOf(runId: string) {
  const { asc, eq } = await import("drizzle-orm");
  return client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, runId))
    .orderBy(asc(tables.runSteps.position));
}

test("a second step is shown what the first one produced", async () => {
  const { id: taskId } = await task("digest", "list the subjects");
  await addStep({ taskId, name: "write", prompt: "write them down", position: 0 });
  replies = ["one subject", "written"];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");
  // The run's output is the last step's, and its cost is every step's.
  expect(run.output).toBe("written");
  expect(run.totalTokens).toBe(30);

  expect(prompts[0]).toBe("list the subjects");
  expect(prompts[1]).toContain("one subject");
  expect(prompts[1]).toContain("write them down");

  const rows = await stepsOf(run.id);
  expect(rows.map((row) => [row.name, row.status, row.depth])).toEqual([
    ["digest", "ok", 0],
    ["write", "ok", 0],
  ]);
  // The task's own prompt is a step of the run without being a row in the flow.
  expect(rows[0].stepId).toBeNull();
  expect(rows[1].stepId).not.toBeNull();
});

test("a decision runs the arm it chose and nothing else", async () => {
  const { id: taskId } = await task("mail", "read the last five emails");
  const decision = await addStep({
    taskId,
    name: "any errors?",
    kind: "decision",
    prompt: "do any of these report an application error?",
    cases: ["error", "clean"],
    position: 0,
  });
  await addStep({
    taskId,
    parentId: decision.id,
    branch: "error",
    name: "write it up",
    prompt: "write an md file",
    position: 0,
  });
  await addStep({
    taskId,
    parentId: decision.id,
    branch: "clean",
    name: "just print",
    prompt: "print the subject lines",
    position: 0,
  });
  replies = ["five emails, one from the build", 'Looks bad.\n{"case": "error"}', "wrote it"];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");

  const rows = await stepsOf(run.id);
  expect(rows.map((row) => [row.name, row.status, row.branch, row.depth])).toEqual([
    ["mail", "ok", "", 0],
    ["any errors?", "ok", "error", 0],
    ["write it up", "ok", "", 1],
  ]);
  // The arm not taken never ran, so it left nothing behind.
  expect(rows.some((row) => row.name === "just print")).toBe(false);
  // A decision is a step like any other: what it said is context for what runs next.
  expect(prompts[2]).toContain("five emails");
  expect(prompts[2]).toContain("Looks bad.");
});

test("a disabled step is recorded as skipped, and the run carries on", async () => {
  const { id: taskId } = await task("partly off", "start");
  await addStep({ taskId, name: "off", prompt: "never", position: 0, enabled: false });
  await addStep({ taskId, name: "on", prompt: "carry on", position: 1 });
  replies = ["started", "carried on"];

  const run = await runner.runTask(taskId);
  const rows = await stepsOf(run.id);
  expect(rows.map((row) => [row.name, row.status])).toEqual([
    ["partly off", "ok"],
    ["off", "skipped"],
    ["on", "ok"],
  ]);
  // The skipped step said nothing, so it is not part of what the next one was shown.
  expect(prompts[1]).not.toContain("never");
});

test("a decision that answers with nothing on offer fails the run, loudly", async () => {
  const { id: taskId } = await task("undecided", "look");
  await addStep({
    taskId,
    name: "pick",
    kind: "decision",
    prompt: "which is it?",
    cases: ["error", "clean"],
    position: 0,
  });
  // Both the decision itself and the extraction call that follows it answer off the menu.
  replies = ["looked", "no idea", "still no idea"];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("error");
  expect(run.error).toMatch(/did not answer with one of: error, clean/);

  const rows = await stepsOf(run.id);
  expect(rows.map((row) => [row.name, row.status])).toEqual([
    ["undecided", "ok"],
    ["pick", "error"],
  ]);
});

test("stopping mid-flow ends the run and the step it was in as stopped", async () => {
  const { id: taskId } = await task("slow", "first");
  await addStep({ taskId, name: "hangs", prompt: "second", position: 0 });
  replies = ["done"];
  // The task's own prompt answers; the step after it never does.
  hangAfter = 1;

  const finished = runner.runTask(taskId);
  while (received < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(runner.stopTask(taskId)).toBe(true);

  const run = await finished;
  expect(run.status).toBe("stopped");

  const rows = await stepsOf(run.id);
  expect(rows.map((row) => [row.name, row.status])).toEqual([
    ["slow", "ok"],
    ["hangs", "stopped"],
  ]);
  // A stopped step did what was asked of it, so it has no error to report.
  expect(rows[1].error).toBe("");
  expect(rows[1].finishedAt).not.toBeNull();
});

test("a run started by hand can carry a payload, and it reaches the prompt and the row", async () => {
  const { id: taskId } = await task("replay", "the delivery said {{event}}");
  replies = ["read it"];

  // Through the schema rather than the runner directly: the argument is the point of the
  // feature — a failed webhook run is replayed by handing its stored body back — and the
  // wiring from that argument to the prompt is what would break silently.
  const { schema } = await import("../server/graphql/schema.ts");
  const { graphql } = await import("graphql");
  const result = await graphql({
    schema,
    source: `mutation Run($taskId: String!, $payload: JSON) {
       runTask(taskId: $taskId, payload: $payload) { id status triggerId }
     }`,
    variableValues: { taskId, payload: { pushed: ["a", "b"] } },
  });
  expect(result.errors).toBeUndefined();
  const run = (result.data as { runTask: { id: string; status: string; triggerId: null } }).runTask;
  expect(run.status).toBe("ok");
  // No trigger fired. A replay that claimed the webhook it was copied from would put a delivery
  // in the history that nobody sent.
  expect(run.triggerId).toBeNull();

  expect(prompts[0]).toContain(`"pushed"`);

  const { eq } = await import("drizzle-orm");
  const [row] = await client.db.select().from(tables.runs).where(eq(tables.runs.id, run.id));
  expect(row.payload).toEqual({ pushed: ["a", "b"] });
});
