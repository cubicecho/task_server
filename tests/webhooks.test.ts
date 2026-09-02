import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

// Importing the schema builds it against the live tables, so give the database a home first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-webhooks-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let db: typeof import("../server/db/client.ts").db;
let tables: typeof import("../server/db/schema.ts");
let app: express.Express;
let started: string[];

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  db = (await import("../server/db/client.ts")).db;
  tables = await import("../server/db/schema.ts");

  // The dispatcher's job is deciding *what* to run; running it is `fireTask`'s, and it would
  // need a model. Recording the calls is the whole of what this needs from it — along with the
  // shape of the answer, since telling a started run from a skipped one is what is under test.
  // `fireTask` recording the skip itself is `fire-task.test.ts`, against a real database.
  started = [];
  vi.doMock("../server/runner/run.ts", () => ({
    fireTask: (taskId: string) => {
      started.push(taskId);
      const run = { id: `run-${taskId}` };
      return Promise.resolve({ started: true, run, done: Promise.resolve(run) });
    },
  }));

  const { mountWebhooks } = await import("../server/webhooks.ts");
  app = express();
  mountWebhooks(app);
});

beforeEach(async () => {
  started.length = 0;
  await db.delete(tables.triggers);
  await db.delete(tables.tasks);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Drives the router over a real socket, so the route matching is the real thing too. */
async function post(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

async function task(name: string, trigger: Partial<typeof tables.triggers.$inferInsert> = {}) {
  const [row] = await db.insert(tables.tasks).values({ name, prompt: "do the thing" }).returning();
  await db
    .insert(tables.triggers)
    .values({ taskId: row.id, kind: "event", event: name, ...trigger });
  return row;
}

test("an id nothing is listening for is still answered", async () => {
  const { status, body } = await post("nobody-home");
  expect(status).toBe(200);
  expect(body).toEqual({ ok: true, event: "nobody-home", dispatched: [], refused: [] });
  expect(started).toEqual([]);
});

test("an id a trigger is listening for runs its task", async () => {
  const row = await task("deploy");

  const { body } = await post("deploy");
  expect(body.dispatched).toEqual([{ taskId: row.id, name: "deploy", runId: `run-${row.id}` }]);
  expect(started).toEqual([row.id]);
});

test("one id fires every task listening for it", async () => {
  const first = await task("fanout");
  const [second] = await db
    .insert(tables.tasks)
    .values({ name: "second", prompt: "also" })
    .returning();
  await db.insert(tables.triggers).values({ taskId: second.id, kind: "event", event: "fanout" });

  const { body } = await post("fanout");
  expect(started.sort()).toEqual([first.id, second.id].sort());
  expect((body.dispatched as unknown[]).length).toBe(2);
});

test("a disabled trigger, a disabled task and a cron trigger are all left alone", async () => {
  await task("off-trigger", { enabled: false });

  const [disabled] = await db
    .insert(tables.tasks)
    .values({ name: "off-task", prompt: "no", enabled: false })
    .returning();
  await db
    .insert(tables.triggers)
    .values({ taskId: disabled.id, kind: "event", event: "off-task" });

  // A cron trigger whose `event` column happens to hold the same string is not a webhook.
  const [cron] = await db.insert(tables.tasks).values({ name: "cron", prompt: "no" }).returning();
  await db
    .insert(tables.triggers)
    .values({ taskId: cron.id, kind: "cron", cron: "* * * * *", event: "cron" });

  for (const id of ["off-trigger", "off-task", "cron"]) {
    const { body } = await post(id);
    expect(body).toMatchObject({ ok: true, dispatched: [] });
  }
  expect(started).toEqual([]);
});

test("a task that was already running is reported as refused, not dispatched", async () => {
  const row = await task("already-running");
  const run = await import("../server/runner/run.ts");
  const reason = 'task "already-running" is already running';
  const refuse = vi
    .spyOn(run, "fireTask")
    .mockResolvedValueOnce({ started: false, run: { id: "run-skipped" } as never, reason });

  const { status, body } = await post("already-running");
  expect(status).toBe(200);
  expect(refuse).toHaveBeenCalledWith(row.id, expect.any(String));

  // Nothing started, so nothing may be reported as dispatched — and the skip has a run id of
  // its own, so what the sender is told and what the Runs page shows are one delivery.
  expect(body.dispatched).toEqual([]);
  expect(body.refused).toEqual([
    { taskId: row.id, name: "already-running", runId: "run-skipped", reason },
  ]);
  refuse.mockRestore();
});

test("a refusal for one task does not stop another listening for the same id", async () => {
  const stuck = await task("shared");
  const [ok] = await db.insert(tables.tasks).values({ name: "ok", prompt: "yes" }).returning();
  await db.insert(tables.triggers).values({ taskId: ok.id, kind: "event", event: "shared" });

  const run = await import("../server/runner/run.ts");
  const real = run.fireTask as unknown as (id: string) => Promise<unknown>;
  const refuse = vi.spyOn(run, "fireTask").mockImplementation(((id: string) => {
    return id === stuck.id
      ? Promise.resolve({ started: false, run: { id: "run-skipped" }, reason: "already running" })
      : real(id);
  }) as typeof run.fireTask);

  const { body } = await post("shared");
  expect(body.dispatched).toEqual([{ taskId: ok.id, name: "ok", runId: `run-${ok.id}` }]);
  expect(body.refused).toEqual([
    { taskId: stuck.id, name: "shared", runId: "run-skipped", reason: "already running" },
  ]);
  refuse.mockRestore();
});

test("a task that has gone missing is logged, and named in neither list", async () => {
  const row = await task("vanished");
  const run = await import("../server/runner/run.ts");
  const gone = vi
    .spyOn(run, "fireTask")
    .mockRejectedValueOnce(new Error(`no task with id ${row.id}`));

  const { status, body } = await post("vanished");
  expect(status).toBe(200);
  // Nothing ran and nothing was written down, so there is nothing honest to report either way.
  expect(body).toEqual({ ok: true, event: "vanished", dispatched: [], refused: [] });
  expect(gone).toHaveBeenCalled();
  gone.mockRestore();
});
