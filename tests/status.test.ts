import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type GraphQLSchema, graphql, print } from "graphql";
import { beforeAll, expect, test } from "vitest";
import { type Health, tally, taskHealth } from "@/lib/task-health";
import { StatusDocument, type StatusQuery } from "../web/__generated__/graphql/graphql.ts";

// The schema is built from the live Drizzle tables at import time, so the database has to be
// pointed somewhere disposable before anything under server/ is loaded.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-status-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let schema: GraphQLSchema;
const ids: Record<string, string> = {};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  schema = (await import("../server/graphql/schema.ts")).schema;
  const db = (await import("../server/db/client.ts")).db;
  const tables = await import("../server/db/schema.ts");

  // One task per answer the page can give, plus the case that tells the collision rule from a
  // rule that just asks whether a skipped row exists at all.
  const seed = async (name: string, enabled = true) => {
    const [task] = await db
      .insert(tables.tasks)
      .values({ name, prompt: "go", enabled })
      .returning();
    ids[name] = task.id;
    return task.id;
  };

  const armed = async (taskId: string, enabled = true) => {
    await db.insert(tables.triggers).values({ taskId, kind: "cron", cron: "0 * * * *", enabled });
  };

  const refused = await seed("refused");
  await armed(refused);
  await db.insert(tables.runs).values([
    { taskId: refused, status: "ok", startedAt: minutesAgo(30), finishedAt: minutesAgo(29) },
    {
      taskId: refused,
      status: "skipped",
      error: "already running",
      attempts: 4,
      startedAt: minutesAgo(20),
      finishedAt: minutesAgo(5),
    },
  ]);

  // The same two rows the other way round: something has run since the last collision, so the
  // task is not behind any more. A rule that only asked "is there a skipped row" gets this wrong.
  const recovered = await seed("recovered");
  await armed(recovered);
  await db.insert(tables.runs).values([
    {
      taskId: recovered,
      status: "skipped",
      error: "already running",
      attempts: 2,
      startedAt: minutesAgo(40),
      finishedAt: minutesAgo(35),
    },
    { taskId: recovered, status: "ok", startedAt: minutesAgo(10), finishedAt: minutesAgo(9) },
  ]);

  const broken = await seed("broken");
  await armed(broken);
  await db.insert(tables.runs).values([
    { taskId: broken, status: "ok", startedAt: minutesAgo(90), finishedAt: minutesAgo(89) },
    { taskId: broken, status: "error", error: "model said no", startedAt: minutesAgo(5) },
  ]);

  const running = await seed("running");
  await armed(running);
  await db
    .insert(tables.runs)
    .values({ taskId: running, status: "running", startedAt: minutesAgo(1) });

  // Disabled, and its last run failed: the failure is what the page leads with, because turning
  // a broken task off is not the same as having fixed it.
  const off = await seed("off", false);
  await armed(off, false);
  await db.insert(tables.runs).values({ taskId: off, status: "ok", startedAt: minutesAgo(200) });

  // Enabled with a trigger that is switched off — nothing arms it, so it only runs by hand.
  const manual = await seed("manual");
  await armed(manual, false);

  // A clean last run and a firing that found the server full. Nothing failed and nothing is
  // lost, and the task is still a delivery behind — which is the case a rule reading only the
  // last run calls fine.
  const waiting = await seed("waiting");
  await armed(waiting);
  await db.insert(tables.runs).values([
    { taskId: waiting, status: "ok", startedAt: minutesAgo(12), finishedAt: minutesAgo(11) },
    {
      taskId: waiting,
      status: "queued",
      error: "4 runs already going, and the limit is 4",
      attempts: 3,
      startedAt: minutesAgo(2),
    },
  ]);

  const fine = await seed("fine");
  await armed(fine);
  await db.insert(tables.runs).values({ taskId: fine, status: "ok", startedAt: minutesAgo(15) });
});

const ask = async () => {
  const result = await graphql({ schema, source: print(StatusDocument) });
  expect(result.errors).toBeUndefined();
  return result.data as unknown as StatusQuery;
};

test("each task lands in the heap its rows say it is in", async () => {
  const data = await ask();
  const health = Object.fromEntries(
    data.tasks.map((task) => [task.name, taskHealth(task)]),
  ) as Record<string, Health>;

  expect(health).toEqual({
    refused: "refused",
    recovered: "fine",
    broken: "broken",
    running: "running",
    waiting: "waiting",
    off: "off",
    manual: "manual",
    fine: "fine",
  });
});

test("the tiles count what the list shows", async () => {
  const data = await ask();
  expect(tally(data.tasks)).toEqual({
    refused: 1,
    broken: 1,
    running: 1,
    waiting: 1,
    off: 1,
    manual: 1,
    fine: 2,
  });
});

test("the skipped row carries how many firings it stands for", async () => {
  const data = await ask();
  const task = data.tasks.find((row) => row.name === "refused");
  expect(task?.collision[0]?.attempts).toBe(4);
  // `last` excludes skipped rows, so the newest thing that actually ran is what it reports —
  // not the refusal that happened after it.
  expect(task?.last[0]?.status).toBe("ok");
});

test("a firing waiting for a slot is not the task's last run", async () => {
  const data = await ask();
  const task = data.tasks.find((row) => row.name === "waiting");
  expect(task?.waiting[0]?.attempts).toBe(3);
  // The queued row is the newer of the two and is still excluded: it has not run, so reporting
  // it as the last run would say the task is doing something it has not started.
  expect(task?.last[0]?.status).toBe("ok");
});

test("failures are the error runs, newest first, with the task named", async () => {
  const data = await ask();
  expect(data.failures.map((failure) => failure.task?.name)).toEqual(["broken"]);
  expect(data.failures[0]?.error).toBe("model said no");
});

test("a task disabled after a clean run is off, not broken", async () => {
  const data = await ask();
  const task = data.tasks.find((row) => row.name === "off");
  expect(taskHealth(task as StatusQuery["tasks"][number])).toBe("off");
});
