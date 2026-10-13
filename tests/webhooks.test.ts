import express from "express";
import { beforeAll, beforeEach, expect, test } from "vitest";
import { dataDir } from "./helpers.ts";

// Importing the schema builds it against the live tables, so give the database a home first.
dataDir("webhooks");

let db: typeof import("../server/db/client.ts").db;
let tables: typeof import("../server/db/schema.ts");
let app: express.Express;

type Fire = typeof import("../server/runner/run.ts").fireTask;
type Fired = Awaited<ReturnType<Fire>>;

/** The row a firing answers with. The dispatcher reads its id and nothing else. */
const run = (id: string) => ({ id }) as Fired["run"];

const started: string[] = [];
const payloads: unknown[] = [];
const triggers: (string | undefined)[] = [];
/** What a task's firing answers instead of starting, for the test that set it. */
const answers = new Map<string, () => Promise<Fired>>();

// The dispatcher's job is deciding *what* to run; running it is `fireTask`'s, and it would
// need a model. Recording the calls is the whole of what this needs from it — along with the
// shape of the answer, since telling a started run from a skipped one is what is under test.
// `fireTask` recording the skip itself is `fire-task.test.ts`, against a real database.
const fire: Fire = (taskId, triggerId, payload) => {
  started.push(taskId);
  triggers.push(triggerId);
  payloads.push(payload);
  const answer = answers.get(taskId);
  if (answer) {
    return answer();
  }
  const row = run(`run-${taskId}`);
  return Promise.resolve({ started: true, run: row, done: Promise.resolve(row) });
};

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  db = (await import("../server/db/client.ts")).db;
  tables = await import("../server/db/schema.ts");

  const { mountWebhooks } = await import("../server/webhooks.ts");
  app = express();
  mountWebhooks(app, fire);
});

beforeEach(async () => {
  started.length = 0;
  payloads.length = 0;
  triggers.length = 0;
  answers.clear();
  await db.delete(tables.triggers);
  await db.delete(tables.tasks);
});

/**
 * Drives the router over a real socket, so the route matching is the real thing too.
 *
 * `body` is sent verbatim rather than encoded, so a test can post something that is not JSON at
 * all and see what the route makes of it.
 */
async function post(
  id: string,
  body = JSON.stringify({ hello: "world" }),
  headers: Record<string, string> = { "content-type": "application/json" },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/${id}`, {
      method: "POST",
      headers,
      body,
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
  expect(body).toEqual({ ok: true, event: "nobody-home", dispatched: [], queued: [], refused: [] });
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
  const reason = 'task "already-running" is already running';
  answers.set(row.id, () =>
    Promise.resolve({ started: false, queued: false, run: run("run-skipped"), reason }),
  );

  const { status, body } = await post("already-running");
  expect(status).toBe(200);
  expect(started).toEqual([row.id]);
  expect(triggers).toEqual([expect.any(String)]);
  expect(payloads).toEqual([{ hello: "world" }]);

  // Nothing started, so nothing may be reported as dispatched — and the skip has a run id of
  // its own, so what the sender is told and what the Runs page shows are one delivery.
  expect(body.dispatched).toEqual([]);
  expect(body.refused).toEqual([
    { taskId: row.id, name: "already-running", runId: "run-skipped", reason },
  ]);
});

test("a delivery that met a full server is reported as queued, not refused", async () => {
  const row = await task("full-house");
  const reason = "4 runs already going, and the limit is 4";
  answers.set(row.id, () =>
    Promise.resolve({ started: false, queued: true, run: run("run-queued"), reason }),
  );

  const { body } = await post("full-house");
  // The two are not the same news. A refusal is a delivery that will not run; this one will,
  // in the row named here, as soon as a slot comes back.
  expect(body.dispatched).toEqual([]);
  expect(body.refused).toEqual([]);
  expect(body.queued).toEqual([
    { taskId: row.id, name: "full-house", runId: "run-queued", reason },
  ]);
});

test("a refusal for one task does not stop another listening for the same id", async () => {
  const stuck = await task("shared");
  const [ok] = await db.insert(tables.tasks).values({ name: "ok", prompt: "yes" }).returning();
  await db.insert(tables.triggers).values({ taskId: ok.id, kind: "event", event: "shared" });

  answers.set(stuck.id, () =>
    Promise.resolve({
      started: false,
      queued: false,
      run: run("run-skipped"),
      reason: "already running",
    }),
  );

  const { body } = await post("shared");
  expect(body.dispatched).toEqual([{ taskId: ok.id, name: "ok", runId: `run-${ok.id}` }]);
  expect(body.refused).toEqual([
    { taskId: stuck.id, name: "shared", runId: "run-skipped", reason: "already running" },
  ]);
});

test("a task that has gone missing is logged, and named in neither list", async () => {
  const row = await task("vanished");
  answers.set(row.id, () => Promise.reject(new Error(`no task with id ${row.id}`)));

  const { status, body } = await post("vanished");
  expect(status).toBe(200);
  // Nothing ran and nothing was written down, so there is nothing honest to report either way.
  expect(body).toEqual({ ok: true, event: "vanished", dispatched: [], queued: [], refused: [] });
  expect(started).toEqual([row.id]);
});

test("the body is handed to every task listening for the id", async () => {
  await task("payload");
  const [second] = await db.insert(tables.tasks).values({ name: "two", prompt: "x" }).returning();
  await db.insert(tables.triggers).values({ taskId: second.id, kind: "event", event: "payload" });

  await post("payload", JSON.stringify({ ref: "refs/heads/main", count: 3 }));
  expect(started.length).toBe(2);
  expect(payloads).toEqual([
    { ref: "refs/heads/main", count: 3 },
    { ref: "refs/heads/main", count: 3 },
  ]);
});

test("a body that will not parse is a delivery with no payload, not a failure", async () => {
  const row = await task("broken-body");

  // Declared as JSON and then not JSON: the parser rejects it, and the route may not turn that
  // into a non-200 — the id arrived, which is the whole of the message.
  const { status, body } = await post("broken-body", "{not json at all");
  expect(status).toBe(200);
  expect(body.dispatched).toEqual([
    { taskId: row.id, name: "broken-body", runId: `run-${row.id}` },
  ]);
  expect(payloads).toEqual([null]);
});

test("a body that is not JSON at all still fires, with nothing in it", async () => {
  await task("no-content-type");

  const { status } = await post("no-content-type", "ping", { "content-type": "text/plain" });
  expect(status).toBe(200);
  expect(payloads).toEqual([null]);
});

test("a body over the limit is a delivery with no payload, not a failure", async () => {
  const row = await task("too-big");

  // Just past the megabyte the parser reads. The id arrived, so the task runs; what it cannot
  // have is a body nobody agreed to hold.
  const { status, body } = await post("too-big", JSON.stringify({ blob: "x".repeat(1024 * 1024) }));
  expect(status).toBe(200);
  expect(body.dispatched).toEqual([{ taskId: row.id, name: "too-big", runId: `run-${row.id}` }]);
  expect(payloads).toEqual([null]);
});
