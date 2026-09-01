import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-cleanup-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let db: typeof import("../server/db/client.ts").db;
let tables: typeof import("../server/db/schema.ts");
let prune: typeof import("../server/scheduler/cleanup.ts").prune;
let taskId: string;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  db = (await import("../server/db/client.ts")).db;
  tables = await import("../server/db/schema.ts");
  prune = (await import("../server/scheduler/cleanup.ts")).prune;
});

beforeEach(async () => {
  await db.delete(tables.runs);
  await db.delete(tables.tasks);
  const [task] = await db.insert(tables.tasks).values({ name: "t", prompt: "p" }).returning();
  taskId = task.id;
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const retention = (days: number) =>
  db
    .update(tables.settings)
    .set({ runRetentionDays: days })
    .where(eq(tables.settings.id, "default"));

const run = (age: number, status: "ok" | "running" = "ok") =>
  db.insert(tables.runs).values({ taskId, status, startedAt: daysAgo(age) });

const remaining = async () => (await db.select().from(tables.runs)).length;

test("zero keeps everything, however old", async () => {
  await retention(0);
  await run(3650);

  expect(await prune()).toBe(0);
  expect(await remaining()).toBe(1);
});

test("runs past the window go and runs inside it stay", async () => {
  await retention(7);
  await run(30);
  await run(8);
  await run(6);
  await run(0);

  expect(await prune()).toBe(2);
  expect(await remaining()).toBe(2);
});

test("a run still going is never pruned, however old it looks", async () => {
  await retention(1);
  await run(90, "running");

  expect(await prune()).toBe(0);
  expect(await remaining()).toBe(1);
});

test("a pruned run takes its steps with it and leaves its task alone", async () => {
  await retention(1);
  const [old] = await db
    .insert(tables.runs)
    .values({ taskId, status: "ok", startedAt: daysAgo(5) })
    .returning();
  await db.insert(tables.runSteps).values({ runId: old.id, name: "step", status: "ok" });

  expect(await prune()).toBe(1);
  expect((await db.select().from(tables.runSteps)).length).toBe(0);
  expect((await db.select().from(tables.tasks)).length).toBe(1);
});
