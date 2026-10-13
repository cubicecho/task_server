import { eq } from "drizzle-orm";
import { type GraphQLSchema, graphql } from "graphql";
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
let schema: GraphQLSchema;
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
  ({ schema } = await import("../server/graphql/schema.ts"));

  await useModel(hang);

  // Tasks that have nothing to do with each other. The per-task guard has no opinion about
  // them; only the server-wide one does, which is the whole point of having more than one.
  for (const name of ["first", "second", "third"]) {
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
  for (const { taskId } of Object.values(ids)) {
    runner.stopTask(taskId);
  }
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

/** A firing left waiting, written as `enqueue` writes one, at a time of the test's choosing. */
async function waitingRow(name: string, startedAt = new Date()) {
  const [row] = await db
    .insert(tables.runs)
    .values({ ...ids[name], status: "queued", error: "no slot", startedAt })
    .returning();
  return row;
}

const gql = (source: string, variableValues?: Record<string, unknown>) =>
  graphql({ schema, source, variableValues });

const RUN_TASK = `mutation ($taskId: String!) { runTask(taskId: $taskId) { id } }`;

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

test("the run that has waited longest is the one that starts", async () => {
  started(await fire("first"));
  // Written newest first, so it is the age of the firing that decides and not the order of the
  // rows.
  const newer = await waitingRow("third", new Date(Date.now() - 1_000));
  const older = await waitingRow("second", new Date(Date.now() - 60_000));

  runner.stopTask(ids.first.taskId);
  await until(async () => (await runById(older.id)).status === "running");
  expect((await runById(newer.id)).status).toBe("queued");
});

test("a run left waiting by a server that stopped is picked up by the drain at boot", async () => {
  // Nothing in this process knows about the row: it is what a restart finds in the table.
  const left = await waitingRow("second");

  await runner.drainQueue();
  const row = await runById(left.id);
  expect(row.status).toBe("running");
  // The wait is not part of how long the task took.
  expect(row.startedAt.getTime()).toBeGreaterThan(left.startedAt.getTime());
});

test("raising the ceiling in settings starts what was waiting for it", async () => {
  const waiting = (await full()).run.id;

  // Through the schema: the drain hangs off the settings write hook, and nothing else would
  // notice a hook that had come unwired.
  const raised = await gql(
    `mutation { updateSetting(where: { id: { eq: "default" } }, set: { maxConcurrentRuns: 2 }) { id } }`,
  );
  expect(raised.errors).toBeUndefined();

  await until(async () => (await runById(waiting)).status === "running");
  expect(runner.runningTaskIds().size).toBe(2);
});

test("a run asked for by hand at a full server is refused, and nothing is left waiting", async () => {
  started(await fire("first"));

  // Whoever asked is told now. A row that started while they were not looking is the answer a
  // trigger gets, because nobody is there to hear a refusal.
  const before = (await runsFor(ids.second.taskId)).length;
  const result = await gql(RUN_TASK, { taskId: ids.second.taskId });
  expect(result.errors?.[0]?.message).toMatch(/limit is 1/);
  expect(await runsFor(ids.second.taskId)).toHaveLength(before);
});

test("a run asked for by hand at a task already running is refused without a skip row", async () => {
  await limit(0);
  started(await fire("first"));

  const before = (await runsFor(ids.first.taskId)).length;
  const result = await gql(RUN_TASK, { taskId: ids.first.taskId });
  expect(result.errors?.[0]?.message).toMatch(/already running/);
  expect(await runsFor(ids.first.taskId)).toHaveLength(before);
});
