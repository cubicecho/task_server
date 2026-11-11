import { history, type RunMetrics, resetEvents } from "@cubicecho/agent-core";
import { eq } from "drizzle-orm";
import { type GraphQLSchema, graphql, print } from "graphql";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { RunDetailDocument } from "../web/__generated__/graphql/graphql.ts";
import { type Completion, completion, replyWith, toolCall } from "./fixtures/sse.ts";
import { dataDir, ECHO_FIXTURE, type FakeModel, fakeModel, useModel } from "./helpers.ts";

/**
 * What an MCP server logs while a run's tool call is going: on the run's stream at the row's
 * level, and kept on the step at `warning` or worse — against a real stdio server that logs at
 * four levels, so the level the row sets is one the server itself honoured.
 */

dataDir("server-logs");

let replies: Completion[] = [];
let model: FakeModel;

let client: typeof import("../server/db/client.ts");
let tables: typeof import("../server/db/schema.ts");
let runner: typeof import("../server/runner/run.ts");
let mcp: typeof import("../server/runner/mcp.ts")["mcp"];
let cron: typeof import("../server/scheduler/cron.ts");
let schema: GraphQLSchema;

beforeAll(async () => {
  model = await fakeModel((body, response) => {
    replyWith(response, replies.shift() ?? completion(""), body);
  });
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  client = await import("../server/db/client.ts");
  tables = await import("../server/db/schema.ts");
  runner = await import("../server/runner/run.ts");
  ({ mcp } = await import("../server/runner/mcp.ts"));
  cron = await import("../server/scheduler/cron.ts");
  ({ schema } = await import("../server/graphql/schema.ts"));
  await useModel(model);
});

beforeEach(() => {
  replies = [];
});

afterEach(async () => {
  resetEvents();
  await mcp.shutdown();
  await client.db.delete(tables.mcpServers);
  await client.db.delete(tables.tasks);
});

afterAll(async () => {
  cron.stop();
  await model.close();
});

type Level = (typeof tables.mcpServers.$inferInsert)["logLevel"];

/** The echo server with its logging tool, at this level — the column's default when absent. */
async function echoServer(logLevel?: Level) {
  await client.db.insert(tables.mcpServers).values({
    slug: "echo",
    command: process.execPath,
    args: [ECHO_FIXTURE],
    env: { MCP_ECHO_LOGGING: "1" },
    ...(logLevel === undefined ? {} : { logLevel }),
  });
  await mcp.sync();
}

/** Runs a task whose one step calls `grumble` once, and hands back the run. */
async function grumbleOnce(warnings = 0) {
  const [task] = await client.db
    .insert(tables.tasks)
    .values({ name: "grumbler", prompt: "grumble" })
    .returning();
  replies = [
    toolCall("echo__grumble", JSON.stringify({ warnings }), "call-g"),
    completion("grumbled"),
  ];
  const run = await runner.runTask(task.id);
  expect(run.status).toBe("ok");
  return run;
}

const logsOn = (runId: string) =>
  history(runId)
    .filter((event) => event.kind === "server-log")
    .map(({ id, name, level, text }) => ({ id, name, level, text }));

test("a server at the default level is heard on the stream from warning up, under its call", async () => {
  await echoServer();
  const run = await grumbleOnce();

  expect(logsOn(run.id)).toEqual([
    { id: "call-g", name: "echo__grumble", level: "warning", text: "warning from grumble" },
    { id: "call-g", name: "echo__grumble", level: "error", text: "error from grumble" },
  ]);
});

test("a null level leaves the server its own default, which for this one is everything", async () => {
  await echoServer(null);
  const run = await grumbleOnce();

  expect(logsOn(run.id).map((entry) => entry.level)).toEqual(["debug", "info", "warning", "error"]);
});

test("warnings and worse are kept on the step, and the run's metrics count them", async () => {
  // At debug, so the stream hears all four and the step keeps only the two that matter.
  await echoServer("debug");
  const run = await grumbleOnce();

  const [step] = await client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, run.id));
  expect(step.serverLogs).toEqual([
    { tool: "echo__grumble", level: "warning", text: "warning from grumble" },
    { tool: "echo__grumble", level: "error", text: "error from grumble" },
  ]);

  const [row] = await client.db.select().from(tables.runs).where(eq(tables.runs.id, run.id));
  const metrics = row.metrics as RunMetrics;
  expect(metrics.serverWarnings).toBe(1);
  expect(metrics.serverErrors).toBe(1);

  // And the run page's query reads them back.
  const result = await graphql({
    schema,
    source: print(RunDetailDocument),
    variableValues: { id: run.id },
  });
  expect(result.errors).toBeUndefined();
  const [detail] = (result.data as { runs: { steps: { serverLogs: unknown }[] }[] }).runs;
  expect(detail.steps[0].serverLogs).toEqual(step.serverLogs);
});

test("a step keeps twenty complaints and counts the rest in one entry", async () => {
  await echoServer();
  // A warning and an error of its own, then thirty more warnings: thirty-two in all.
  const run = await grumbleOnce(30);

  const [step] = await client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, run.id));
  const kept = step.serverLogs ?? [];
  expect(kept).toHaveLength(21);
  expect(kept[20]).toEqual({
    tool: "",
    level: "warning",
    text: "12 more messages at warning or worse not kept",
    dropped: 12,
  });

  // The counts are the run's, from every event, so they say what the cap did not keep.
  const [row] = await client.db.select().from(tables.runs).where(eq(tables.runs.id, run.id));
  expect((row.metrics as RunMetrics).serverWarnings).toBe(31);
});

test("a server that is quiet leaves no server logs on its step", async () => {
  await echoServer();
  const [task] = await client.db
    .insert(tables.tasks)
    .values({ name: "pinger", prompt: "ping" })
    .returning();
  replies = [toolCall("echo__ping", "{}"), completion("pong")];
  const run = await runner.runTask(task.id);

  const [step] = await client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, run.id));
  expect(step.serverLogs).toBeNull();
  expect(logsOn(run.id)).toEqual([]);
});
