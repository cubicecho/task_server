import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type GraphQLSchema, graphql, print } from "graphql";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildWhere, NO_FILTERS, WINDOWS } from "@/lib/run-filters";
import { RunsDocument } from "../web/__generated__/graphql/graphql.ts";

// The schema is built from the live Drizzle tables at import time, so the database has to be
// pointed somewhere disposable before anything under server/ is loaded.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-history-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let schema: GraphQLSchema;
let cron: typeof import("../server/scheduler/cron.ts");
let db: typeof import("../server/db/client.ts").db;
let tables: typeof import("../server/db/schema.ts");
const taskIds: Record<string, string> = {};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  schema = (await import("../server/graphql/schema.ts")).schema;
  cron = await import("../server/scheduler/cron.ts");
  db = (await import("../server/db/client.ts")).db;
  tables = await import("../server/db/schema.ts");

  for (const name of ["nightly digest", "deploy watch"]) {
    const [task] = await db.insert(tables.tasks).values({ name, prompt: "go" }).returning();
    taskIds[name] = task.id;
  }

  // Six runs that differ in every way a control on the page can ask about. The two outputs
  // holding "100%" and "1000ms" are the pair that says whether the search term was escaped:
  // an unescaped `%` in the middle of the term matches both.
  await db.insert(tables.runs).values([
    {
      taskId: taskIds["nightly digest"],
      status: "ok",
      startedAt: minutesAgo(5),
      output: "finished at 100% of budget",
    },
    {
      taskId: taskIds["nightly digest"],
      status: "error",
      startedAt: minutesAgo(20),
      error: "the endpoint hung up",
    },
    {
      taskId: taskIds["nightly digest"],
      status: "ok",
      startedAt: minutesAgo(30),
      output: "took 1000ms",
    },
    {
      taskId: taskIds["deploy watch"],
      status: "ok",
      startedAt: minutesAgo(90),
      output: "nothing to do",
    },
    {
      taskId: taskIds["deploy watch"],
      status: "skipped",
      startedAt: minutesAgo(120),
      error: "This task is already running.",
    },
    {
      taskId: taskIds["deploy watch"],
      status: "ok",
      startedAt: minutesAgo(60 * 48),
      output: "nothing to do",
    },
  ]);
});

afterAll(async () => {
  await cron.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The page's own question, asked of a real database.
 *
 * Both halves are the ones that ship: `buildWhere` is what the controls produce, and
 * `RunsDocument` is the document the browser sends — printed here rather than retyped, so a
 * field added to the list cannot pass a test that no longer resembles it.
 */
const ask = async (filters: Partial<typeof NO_FILTERS>, search = "", limit = 50) => {
  const where = buildWhere({ ...NO_FILTERS, ...filters }, search);
  const result = await graphql({
    schema,
    source: print(RunsDocument),
    variableValues: { where, limit },
  });
  expect(result.errors).toBeUndefined();
  return (result.data as { runs: { status: string; output: string; error: string }[] }).runs;
};

test("no controls set asks for no filter at all, and gets the list newest first", async () => {
  expect(buildWhere(NO_FILTERS, "")).toBeUndefined();

  const runs = await ask({});
  expect(runs).toHaveLength(6);
  expect(runs[0].output).toBe("finished at 100% of budget");
});

// `limit` grows a page at a time rather than an `offset` moving down the list, so what the
// second page has to be is the first one with more on the end of it.
test("a page is the newest rows, and the next page still starts at the newest", async () => {
  const first = await ask({}, "", 2);
  expect(first.map((run) => run.output)).toEqual(["finished at 100% of budget", ""]);

  const second = await ask({}, "", 4);
  expect(second.slice(0, 2)).toEqual(first);
  expect(second).toHaveLength(4);
});

test("a status is an enum the server matches exactly", async () => {
  expect((await ask({ status: "error" })).map((run) => run.error)).toEqual([
    "the endpoint hung up",
  ]);
  expect(await ask({ status: "running" })).toHaveLength(0);
});

test("a task filter is the one the runs page never had", async () => {
  const runs = await ask({ taskId: taskIds["deploy watch"] });
  expect(runs).toHaveLength(3);
});

/**
 * The search box is an OR over three columns, one of them on the other side of a relation —
 * which is the half a filter builder cannot be trusted about until it has met postgres.
 */
test("a search reads the output, the error and the task's name", async () => {
  expect(await ask({}, "hung up")).toHaveLength(1);
  expect(await ask({}, "nothing to do")).toHaveLength(2);
  // Neither run on this task says "deploy" anywhere in its own text.
  expect(await ask({}, "deploy watch")).toHaveLength(3);
  // Case, because the operator is `ilike` and nobody types an error message back exactly.
  expect(await ask({}, "HUNG UP")).toHaveLength(1);
});

test("a wildcard in the search term is a character, not a wildcard", async () => {
  const runs = await ask({}, "100%");
  expect(runs.map((run) => run.output)).toEqual(["finished at 100% of budget"]);

  // The same term with the escape removed is what this is guarding against: `%100%%` matches
  // "took 1000ms" too, and a search for a percentage quietly answers with something else.
  expect(await ask({}, "100")).toHaveLength(2);
});

test("a window cuts the list off at the moment it was chosen", async () => {
  const hour = WINDOWS.find((option) => option.value === "hour");
  const day = WINDOWS.find((option) => option.value === "day");

  const within = (ms: number) => new Date(Date.now() - ms).toISOString();

  expect(await ask({ window: "hour", from: within(hour?.ms ?? 0) })).toHaveLength(3);
  expect(await ask({ window: "day", from: within(day?.ms ?? 0) })).toHaveLength(5);
});

test("the controls narrow each other rather than replacing each other", async () => {
  const runs = await ask(
    {
      status: "ok",
      taskId: taskIds["nightly digest"],
      window: "day",
      from: new Date(Date.now() - 86_400_000).toISOString(),
    },
    "budget",
  );
  expect(runs.map((run) => run.output)).toEqual(["finished at 100% of budget"]);
});
