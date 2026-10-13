import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import {
  dataDir,
  type FakeModel,
  hangingModel,
  refused,
  started,
  until,
  useModel,
} from "./helpers.ts";

// Loading anything under server/ builds the schema against the live tables, so point the
// database somewhere disposable first.
dataDir("capacity");

let runner: typeof import("../server/runner/run.ts");
let db: typeof import("../server/db/client.ts").db;
let tables: typeof import("../server/db/schema.ts");
/** A model server that accepts the request and never answers, so a run stays in flight. */
let hang: FakeModel;
const ids: Record<string, { taskId: string; triggerId: string }> = {};

beforeAll(async () => {
  hang = await hangingModel();

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  runner = await import("../server/runner/run.ts");
  db = (await import("../server/db/client.ts")).db;
  tables = await import("../server/db/schema.ts");

  await useModel(hang);

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

// Every test starts at a ceiling of one with nothing running, nothing waiting and both tasks
// enabled, whatever the one before it left — including one that failed halfway.
beforeEach(() => limit(1));

afterEach(async () => {
  // The queue first: a run that stops drains it, and a waiting row would start as this ends.
  await db.delete(tables.runs).where(eq(tables.runs.status, "queued"));
  for (const { taskId } of Object.values(ids)) runner.stopTask(taskId);
  await idle();
  await db.update(tables.tasks).set({ enabled: true });
});

afterAll(async () => {
  await hang.close();
});

const limit = (maxConcurrentRuns: number) =>
  db.update(tables.settings).set({ maxConcurrentRuns }).where(eq(tables.settings.id, "default"));

const runsFor = async (taskId: string) =>
  await db.select().from(tables.runs).where(eq(tables.runs.taskId, taskId));

const runById = async (id: string) => {
  const [row] = await db.select().from(tables.runs).where(eq(tables.runs.id, id));
  return row;
};

const fire = (name: string, payload?: unknown) =>
  runner.fireTask(ids[name].taskId, ids[name].triggerId, payload);

const idle = () => until(() => runner.runningTaskIds().size === 0);

/** A full server: `first` holds the only slot, and the firing at `second` is what comes back. */
async function full() {
  started(await fire("first"));
  return refused(await fire("second"));
}

test("a firing that arrives with no slot free waits instead of being turned away", async () => {
  // A different task from the one running, so nothing about `second` itself refuses this —
  // only the ceiling does.
  const second = await full();
  expect(second.queued).toBe(true);
  expect(second.reason).toMatch(/limit is 1/);

  const row = await runById(second.run.id);
  expect(row.status).toBe("queued");
  // Why it is waiting, in the column a skip uses to say why it never ran.
  expect(row.error).toMatch(/limit is 1/);
  expect(row.finishedAt).toBeNull();
});

test("a second firing at the same full server folds into the row already waiting", async () => {
  const waiting = await full();
  const again = refused(await fire("second", { newest: true }));
  // The same row, not a second one: a sender posting every second would otherwise write a queue
  // of three hundred copies of one delivery.
  expect(again.run.id).toBe(waiting.run.id);

  const queued = (await runsFor(ids.second.taskId)).filter((run) => run.status === "queued");
  expect(queued).toHaveLength(1);
  expect(queued[0].attempts).toBe(2);
  // It will run once, with the delivery whoever is asking has just made.
  expect(queued[0].payload).toEqual({ newest: true });
});

test("the queued run starts in its own row when a slot comes back", async () => {
  const waiting = (await full()).run.id;

  expect(runner.stopTask(ids.first.taskId)).toBe(true);
  await until(async () => (await runById(waiting)).status === "running");

  // The same row the webhook was told about, so the id a sender kept is the id that ends up
  // holding the output.
  expect((await runById(waiting)).error).toBe("");
  expect(runner.runningTaskIds().has(ids.second.taskId)).toBe(true);

  runner.stopTask(ids.second.taskId);
  await idle();
  expect((await runById(waiting)).status).toBe("stopped");
});

test("a task that meets itself is still skipped, not queued", async () => {
  await limit(0);
  started(await fire("first"));

  // Room to spare, and it is still refused: the work is already in flight, and queueing a copy
  // behind it would run a slow task over and over on a schedule it was never meant for.
  const again = refused(await fire("first"));
  expect(again.queued).toBe(false);
  expect((await runById(again.run.id)).status).toBe("skipped");
});

test("zero is no ceiling at all", async () => {
  await limit(0);
  const first = await fire("first");
  const second = await fire("second");
  expect([first.started, second.started]).toEqual([true, true]);
});

test("a task disabled while its run waited does not run", async () => {
  const held = await full();
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
});

test("firings that race for the last slot do not both get it", async () => {
  // Both start in the same tick, which is what a midnight full of cron triggers looks like. A
  // check separated from its claim by an `await` lets both through; the claim is taken before
  // either write for exactly this.
  const [first, second] = await Promise.all([fire("first"), fire("second")]);
  expect([first.started, second.started].filter(Boolean)).toHaveLength(1);

  // The one that lost is waiting, not lost.
  const loser = refused(first.started ? second : first);
  expect(loser.queued).toBe(true);
  expect((await runById(loser.run.id)).status).toBe("queued");
});
