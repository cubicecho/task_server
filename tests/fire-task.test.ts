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

  // The run it collided with is untouched by any of that.
  expect(runner.runningTaskIds().has(taskId)).toBe(true);

  runner.stopTask(taskId);
  if (!first.started) throw new Error("unreachable");
  expect((await first.done).status).toBe("stopped");
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
