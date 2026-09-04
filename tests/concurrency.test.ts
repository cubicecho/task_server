import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";

// Loading anything under server/ builds the schema against the live tables, so point the
// database somewhere disposable first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-capacity-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let runner: typeof import("../server/runner/run.ts");
let db: typeof import("../server/db/client.ts").db;
let tables: typeof import("../server/db/schema.ts");
/** A model server that accepts the request and never answers, so a run stays in flight. */
let hang: http.Server;
const ids: Record<string, { taskId: string; triggerId: string }> = {};

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

  await limit(1);
  await db
    .update(tables.settings)
    .set({ baseUrl: `http://127.0.0.1:${port}/v1`, model: "fake" })
    .where(eq(tables.settings.id, "default"));

  // Two tasks that have nothing to do with each other. The per-task guard has no opinion about
  // them; only the server-wide one does, which is the whole point of the pair.
  for (const name of ["first", "second"]) {
    const [task] = await db.insert(tables.tasks).values({ name, prompt: "wait" }).returning();
    const [trigger] = await db
      .insert(tables.triggers)
      .values({ taskId: task.id, kind: "event", event: name })
      .returning();
    ids[name] = { taskId: task.id, triggerId: trigger.id };
  }
});

afterAll(async () => {
  await new Promise((resolve) => hang.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const limit = (maxConcurrentRuns: number) =>
  db.update(tables.settings).set({ maxConcurrentRuns }).where(eq(tables.settings.id, "default"));

const runsFor = async (taskId: string) =>
  await db.select().from(tables.runs).where(eq(tables.runs.taskId, taskId));

test("a firing that arrives with no slot free is turned away and written down", async () => {
  const first = await runner.fireTask(ids.first.taskId, ids.first.triggerId);
  expect(first.started).toBe(true);
  if (!first.started) throw new Error("unreachable");

  // A different task, so nothing about `second` itself refuses this — only the ceiling does.
  const second = await runner.fireTask(ids.second.taskId, ids.second.triggerId);
  expect(second.started).toBe(false);
  if (second.started) throw new Error("unreachable");
  expect(second.reason).toMatch(/limit is 1/);

  const [skipped] = (await runsFor(ids.second.taskId)).filter((run) => run.id === second.run.id);
  expect(skipped.status).toBe("skipped");
  // The run in the way belongs to the other task. There is no single run blocking a full
  // server, so the skip points at the oldest one — the one whose finishing frees the slot.
  expect(skipped.blockedBy).toBe(first.run.id);
});

test("a second firing into the same full server bumps the row it already wrote", async () => {
  const again = await runner.fireTask(ids.second.taskId, ids.second.triggerId);
  expect(again.started).toBe(false);
  if (again.started) throw new Error("unreachable");

  const skips = (await runsFor(ids.second.taskId)).filter((run) => run.status === "skipped");
  expect(skips).toHaveLength(1);
  expect(skips[0].attempts).toBe(2);
});

test("the slot comes back when the run holding it ends", async () => {
  expect(runner.stopTask(ids.first.taskId)).toBe(true);
  // `done` settles when the run row is written, which is also when the slot is released.
  const [first] = (await runsFor(ids.first.taskId)).filter((run) => run.status !== "skipped");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(runner.runningTaskIds().size).toBe(0);
  expect(first.id).toBeTruthy();

  const second = await runner.fireTask(ids.second.taskId, ids.second.triggerId);
  expect(second.started).toBe(true);
  runner.stopTask(ids.second.taskId);
  await new Promise((resolve) => setTimeout(resolve, 200));
});

test("zero is no ceiling at all", async () => {
  await limit(0);
  const first = await runner.fireTask(ids.first.taskId, ids.first.triggerId);
  const second = await runner.fireTask(ids.second.taskId, ids.second.triggerId);
  expect([first.started, second.started]).toEqual([true, true]);
  runner.stopTask(ids.first.taskId);
  runner.stopTask(ids.second.taskId);
  await new Promise((resolve) => setTimeout(resolve, 200));
});

test("firings that race for the last slot do not both get it", async () => {
  await limit(1);
  // Both start in the same tick, which is what a midnight full of cron triggers looks like. A
  // check separated from its claim by an `await` lets both through; the claim is taken before
  // either write for exactly this.
  const [first, second] = await Promise.all([
    runner.fireTask(ids.first.taskId, ids.first.triggerId),
    runner.fireTask(ids.second.taskId, ids.second.triggerId),
  ]);
  expect([first.started, second.started].filter(Boolean)).toHaveLength(1);
  runner.stopTask(ids.first.taskId);
  runner.stopTask(ids.second.taskId);
  await new Promise((resolve) => setTimeout(resolve, 200));
});
