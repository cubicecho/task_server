import { type GraphQLSchema, graphql, print } from "graphql";
import { afterAll, beforeAll, expect, test } from "vitest";
import { TaskArtifactsDocument } from "../web/__generated__/graphql/graphql.ts";
import { dataDir } from "./helpers.ts";

dataDir("task-artifacts");

let schema: GraphQLSchema;
let cron: typeof import("../server/scheduler/cron.ts");
const taskIds: Record<string, string> = {};
const runIds: string[] = [];

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  schema = (await import("../server/graphql/schema.ts")).schema;
  cron = await import("../server/scheduler/cron.ts");
  const { db } = await import("../server/db/client.ts");
  const tables = await import("../server/db/schema.ts");

  for (const name of ["weekly report", "someone else"]) {
    const [task] = await db.insert(tables.tasks).values({ name, prompt: "go" }).returning();
    taskIds[name] = task.id;
  }
  const weekly = taskIds["weekly report"];

  // Three weekly runs that rewrite the same report, the middle one also linking a draft it never
  // touched again, and the newest one linking two notes in one step — which share an `updatedAt`.
  for (const days of [21, 14, 7]) {
    const [run] = await db
      .insert(tables.runs)
      .values({ taskId: weekly, status: "ok", startedAt: daysAgo(days) })
      .returning();
    runIds.push(run.id);
  }
  const [oldest, middle, newest] = runIds;
  const artifact = (runId: string, uri: string, days: number, title = "") => ({
    runId,
    taskId: weekly,
    uri,
    title,
    serverSlug: "docs",
    createdAt: daysAgo(days),
    updatedAt: daysAgo(days),
  });
  await db
    .insert(tables.runArtifacts)
    .values([
      artifact(oldest, "docs://report.md", 21, "Report, week 1"),
      artifact(middle, "docs://report.md", 14, "Report, week 2"),
      artifact(middle, "docs://draft.md", 14),
      artifact(newest, "docs://report.md", 7, "Report, week 3"),
      artifact(newest, "docs://notes/b.md", 3),
      artifact(newest, "docs://notes/a.md", 3),
    ]);

  const [other] = await db
    .insert(tables.runs)
    .values({ taskId: taskIds["someone else"], status: "ok" })
    .returning();
  await db.insert(tables.runArtifacts).values({
    runId: other.id,
    taskId: taskIds["someone else"],
    uri: "docs://not-mine.md",
  });
});

afterAll(async () => {
  await cron.stop();
});

/** The task page's question, in the document the browser sends, of a real database. */
const ask = async (task: string, limit = 20) => {
  const result = await graphql({
    schema,
    source: print(TaskArtifactsDocument),
    variableValues: { taskId: taskIds[task], limit },
  });
  expect(result.errors).toBeUndefined();
  return (result.data as { runArtifacts: { uri: string; runId: string; title: string }[] })
    .runArtifacts;
};

test("a uri several runs linked is one row, and it is the row the latest run wrote", async () => {
  const rows = await ask("weekly report");
  const reports = rows.filter((row) => row.uri === "docs://report.md");
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ runId: runIds[2], title: "Report, week 3" });
});

test("the rows are newest first, and links made together are in uri order", async () => {
  expect((await ask("weekly report")).map((row) => row.uri)).toEqual([
    "docs://notes/a.md",
    "docs://notes/b.md",
    "docs://report.md",
    "docs://draft.md",
  ]);
});

// The limit counts documents, not links. The four newest links hold the report twice, so a cut
// made before the collapse would come back three rows short of a page and miss the draft.
test("a page is the newest documents, counted after the collapse", async () => {
  expect((await ask("weekly report", 4)).map((row) => row.uri)).toEqual([
    "docs://notes/a.md",
    "docs://notes/b.md",
    "docs://report.md",
    "docs://draft.md",
  ]);
  expect(await ask("weekly report", 2)).toHaveLength(2);
});

test("another task's outputs are not this one's", async () => {
  expect((await ask("someone else")).map((row) => row.uri)).toEqual(["docs://not-mine.md"]);
  expect((await ask("weekly report")).map((row) => row.uri)).not.toContain("docs://not-mine.md");
});
