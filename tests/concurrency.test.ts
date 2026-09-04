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
/** The row the first refused firing was written into, which later tests watch start. */
let waiting = "";

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
  for (const { taskId } of Object.values(ids)) runner.stopTask(taskId);
  await until(() => runner.runningTaskIds().size === 0);
  await new Promise((resolve) => hang.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const limit = (maxConcurrentRuns: number) =>
  db.update(tables.settings).set({ maxConcurrentRuns }).where(eq(tables.settings.id, "default"));

const runsFor = async (taskId: string) =>
  await db.select().from(tables.runs).where(eq(tables.runs.taskId, taskId));

const runById = async (id: string) => {
  const [row] = await db.select().from(tables.runs).where(eq(tables.runs.id, id));
  return row;
};

/** Waits for the drain, which is debounced and then runs on its own. */
async function until(ready: () => boolean | Promise<boolean>, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting");
}

/** Empties the queue between tests that would otherwise inherit each other's waiting rows. */
async function clearQueue() {
  await db.delete(tables.runs).where(eq(tables.runs.status, "queued"));
}

test("a firing that arrives with no slot free waits instead of being turned away", async () => {
  const first = await runner.fireTask(ids.first.taskId, ids.first.triggerId);
  expect(first.started).toBe(true);
  if (!first.started) throw new Error("unreachable");

  // A different task, so nothing about `second` itself refuses this — only the ceiling does.
  const second = await runner.fireTask(ids.second.taskId, ids.second.triggerId);
  expect(second.started).toBe(false);
  if (second.started) throw new Error("unreachable");
  expect(second.queued).toBe(true);
  expect(second.reason).toMatch(/limit is 1/);

  waiting = second.run.id;
  const row = await runById(waiting);
  expect(row.status).toBe("queued");
  // Why it is waiting, in the column a skip uses to say why it never ran.
  expect(row.error).toMatch(/limit is 1/);
  expect(row.finishedAt).toBeNull();
});

test("a second firing at the same full server folds into the row already waiting", async () => {
  const again = await runner.fireTask(ids.second.taskId, ids.second.triggerId, { newest: true });
  expect(again.started).toBe(false);
  if (again.started) throw new Error("unreachable");
  // The same row, not a second one: a sender posting every second would otherwise write a queue
  // of three hundred copies of one delivery.
  expect(again.run.id).toBe(waiting);

  const queued = (await runsFor(ids.second.taskId)).filter((run) => run.status === "queued");
  expect(queued).toHaveLength(1);
  expect(queued[0].attempts).toBe(2);
  // It will run once, with the delivery whoever is asking has just made.
  expect(queued[0].payload).toEqual({ newest: true });
});

test("the queued run starts in its own row when a slot comes back", async () => {
  expect(runner.stopTask(ids.first.taskId)).toBe(true);
  await until(async () => (await runById(waiting)).status === "running");

  const started = await runById(waiting);
  // The same row the webhook was told about, so the id a sender kept is the id that ends up
  // holding the output.
  expect(started.id).toBe(waiting);
  expect(started.error).toBe("");
  expect(runner.runningTaskIds().has(ids.second.taskId)).toBe(true);

  runner.stopTask(ids.second.taskId);
  await until(() => runner.runningTaskIds().size === 0);
  expect((await runById(waiting)).status).toBe("stopped");
});

test("a task that meets itself is still skipped, not queued", async () => {
  await limit(0);
  const first = await runner.fireTask(ids.first.taskId, ids.first.triggerId);
  expect(first.started).toBe(true);

  // Room to spare, and it is still refused: the work is already in flight, and queueing a copy
  // behind it would run a slow task over and over on a schedule it was never meant for.
  const again = await runner.fireTask(ids.first.taskId, ids.first.triggerId);
  expect(again.started).toBe(false);
  if (again.started) throw new Error("unreachable");
  expect(again.queued).toBe(false);
  expect((await runById(again.run.id)).status).toBe("skipped");

  runner.stopTask(ids.first.taskId);
  await until(() => runner.runningTaskIds().size === 0);
});

test("zero is no ceiling at all", async () => {
  const first = await runner.fireTask(ids.first.taskId, ids.first.triggerId);
  const second = await runner.fireTask(ids.second.taskId, ids.second.triggerId);
  expect([first.started, second.started]).toEqual([true, true]);

  runner.stopTask(ids.first.taskId);
  runner.stopTask(ids.second.taskId);
  await until(() => runner.runningTaskIds().size === 0);
  await clearQueue();
});

test("a task disabled while its run waited does not run", async () => {
  await limit(1);
  await runner.fireTask(ids.first.taskId, ids.first.triggerId);
  const held = await runner.fireTask(ids.second.taskId, ids.second.triggerId);
  if (held.started) throw new Error("unreachable");
  expect(held.queued).toBe(true);

  await db
    .update(tables.tasks)
    .set({ enabled: false })
    .where(eq(tables.tasks.id, ids.second.taskId));

  runner.stopTask(ids.first.taskId);
  // Disabling a task means stop firing it, and honouring that minutes late is what a queue that
  // ignored it would do. The row says what became of the firing rather than dropping it.
  await until(async () => (await runById(held.run.id)).status === "skipped");
  expect((await runById(held.run.id)).error).toMatch(/disabled/);
  expect(runner.runningTaskIds().size).toBe(0);

  await db
    .update(tables.tasks)
    .set({ enabled: true })
    .where(eq(tables.tasks.id, ids.second.taskId));
});

test("firings that race for the last slot do not both get it", async () => {
  // Both start in the same tick, which is what a midnight full of cron triggers looks like. A
  // check separated from its claim by an `await` lets both through; the claim is taken before
  // either write for exactly this.
  const [first, second] = await Promise.all([
    runner.fireTask(ids.first.taskId, ids.first.triggerId),
    runner.fireTask(ids.second.taskId, ids.second.triggerId),
  ]);
  expect([first.started, second.started].filter(Boolean)).toHaveLength(1);

  // The one that lost is waiting, not lost.
  const loser = first.started ? second : first;
  if (loser.started) throw new Error("unreachable");
  expect(loser.queued).toBe(true);
  expect((await runById(loser.run.id)).status).toBe("queued");

  for (const { taskId } of Object.values(ids)) runner.stopTask(taskId);
  await until(() => runner.runningTaskIds().size === 0);
  await clearQueue();
});
