import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

// Loading anything under server/ builds the schema against the live tables, so point the
// database somewhere disposable first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-fire-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let runner: typeof import("../server/runner/run.ts");
let db: typeof import("../server/db/client.ts").db;
let tables: typeof import("../server/db/schema.ts");
/** A model server that accepts the request and never answers, so the run stays in flight. */
let hang: http.Server;
let taskId = "";
let triggerId = "";

beforeAll(async () => {
  hang = http.createServer(() => {});
  await new Promise<void>((resolve) => hang.listen(0, "127.0.0.1", resolve));
  const address = hang.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  runner = await import("../server/runner/run.ts");
  db = (await import("../server/db/client.ts")).db;
  tables = await import("../server/db/schema.ts");

  const { eq } = await import("drizzle-orm");
  await db
    .update(tables.settings)
    .set({ baseUrl: `http://127.0.0.1:${port}/v1`, model: "fake" })
    .where(eq(tables.settings.id, "default"));

  const [task] = await db.insert(tables.tasks).values({ name: "slow", prompt: "wait" }).returning();
  taskId = task.id;
  const [trigger] = await db
    .insert(tables.triggers)
    .values({ taskId, kind: "event", event: "fire" })
    .returning();
  triggerId = trigger.id;
});

afterAll(async () => {
  await new Promise((resolve) => hang.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const runsFor = async (task: string) => {
  const { eq } = await import("drizzle-orm");
  return await db.select().from(tables.runs).where(eq(tables.runs.taskId, task));
};

test("a trigger that fires at a task already running records the skip as a run of its own", async () => {
  const first = await runner.fireTask(taskId, triggerId);
  expect(first.started).toBe(true);

  const second = await runner.fireTask(taskId, triggerId);
  expect(second.started).toBe(false);
  if (second.started) throw new Error("unreachable");
  expect(second.reason).toMatch(/already running/);

  // The skip is a row, not a log line: a delivery that quietly did nothing is the one thing
  // nobody can see afterwards, and the Runs page is where they would look for it.
  const [skipped] = (await runsFor(taskId)).filter((run) => run.id === second.run.id);
  expect(skipped.status).toBe("skipped");
  expect(skipped.error).toMatch(/already running/);
  expect(skipped.finishedAt).toBeInstanceOf(Date);
  // It belongs to the trigger that fired it, so a trigger firing into a wall is traceable.
  expect(skipped.triggerId).toBe(triggerId);
  // And it names what was in the way, which is what makes the skip readable without guessing.
  expect(skipped.blockedBy).toBe(first.started ? first.run.id : null);
  expect(skipped.attempts).toBe(1);

  // The run it collided with is untouched by any of that.
  expect(runner.runningTaskIds().has(taskId)).toBe(true);

  runner.stopTask(taskId);
  if (!first.started) throw new Error("unreachable");
  expect((await first.done).status).toBe("stopped");
});

test("firing again into the same collision bumps the row rather than adding one", async () => {
  const first = await runner.fireTask(taskId, triggerId, { n: 1 });
  if (!first.started) throw new Error("unreachable");

  const before = (await runsFor(taskId)).length;
  const skips: Awaited<ReturnType<typeof runner.fireTask>>[] = [];
  for (const n of [2, 3, 4]) skips.push(await runner.fireTask(taskId, triggerId, { n }));

  // Three firings, one row: a sender posting faster than the task runs must not be able to
  // bury the runs someone opened the page to read.
  expect((await runsFor(taskId)).length).toBe(before + 1);
  expect(new Set(skips.map((skip) => skip.run.id)).size).toBe(1);

  const [skipped] = (await runsFor(taskId)).filter((run) => run.id === skips[0].run.id);
  expect(skipped.attempts).toBe(3);
  // The row stands for all three, and carries the most recent of them.
  expect(skipped.payload).toEqual({ n: 4 });
  expect(skipped.blockedBy).toBe(first.run.id);

  runner.stopTask(taskId);
  await first.done;

  // A collision with a *different* run is a different fact and gets its own row.
  const next = await runner.fireTask(taskId, triggerId);
  if (!next.started) throw new Error("unreachable");
  const later = await runner.fireTask(taskId, triggerId);
  expect(later.run.id).not.toBe(skips[0].run.id);

  runner.stopTask(taskId);
  await next.done;
});

test("a webhook body is kept on the run it started", async () => {
  const fired = await runner.fireTask(taskId, triggerId, { ref: "main" });
  if (!fired.started) throw new Error("unreachable");
  expect(fired.run.payload).toEqual({ ref: "main" });

  runner.stopTask(taskId);
  await fired.done;
});

test("a task that no longer exists throws rather than inventing a run for it", async () => {
  await expect(runner.fireTask("gone", "nobody")).rejects.toThrow(/no task/);
  expect(await runsFor("gone")).toEqual([]);
});

test("once the run is over the next firing starts a new one", async () => {
  const fired = await runner.fireTask(taskId, triggerId);
  expect(fired.started).toBe(true);
  if (!fired.started) throw new Error("unreachable");
  expect(fired.run.status).toBe("running");

  runner.stopTask(taskId);
  await fired.done;
});
