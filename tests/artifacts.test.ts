import fs from "node:fs";
import path from "node:path";
import { history, resetEvents } from "@cubicecho/agent-core";
import type { ToolHook } from "@cubicecho/agent-mcp-pool";
import { eq } from "drizzle-orm";
import { type GraphQLSchema, graphql, print } from "graphql";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import {
  McpResourceDocument,
  RunDetailDocument,
  RunsDocument,
} from "../web/__generated__/graphql/graphql.ts";
import { type Completion, completion, replyWith, toolCall } from "./fixtures/sse.ts";
import { dataDir, ECHO_FIXTURE, type FakeModel, fakeModel, useModel } from "./helpers.ts";

/**
 * What a run's tool calls link to as made, kept as `run_artifacts` rows — against a real stdio
 * server whose `write` answers with a `resource_link`, so the link the row holds is one the
 * protocol carried.
 */

const dir = dataDir("artifacts");

/** Every call the fixture received, one JSON line each: a hook's never shows up on the run. */
const callLog = path.join(dir, "calls.log");

let replies: Completion[] = [];
let model: FakeModel;

let client: typeof import("../server/db/client.ts");
let tables: typeof import("../server/db/schema.ts");
let runner: typeof import("../server/runner/run.ts");
let hooks: typeof import("../server/runner/hooks.ts");
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
  hooks = await import("../server/runner/hooks.ts");
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
  await hooks.hooksSettled();
  await mcp.shutdown();
  await client.db.delete(tables.mcpServers);
  await client.db.delete(tables.tasks);
  fs.rmSync(callLog, { force: true });
});

afterAll(async () => {
  cron.stop();
  await model.close();
});

/** The echo server with its linking tool, and these hooks on its row. */
async function echoServer(rowHooks: ToolHook[] = []) {
  const [row] = await client.db
    .insert(tables.mcpServers)
    .values({
      slug: "echo",
      label: "Echo",
      command: process.execPath,
      args: [ECHO_FIXTURE],
      env: { MCP_ECHO_LINKS: "1", MCP_ECHO_RESOURCES: "1", MCP_ECHO_CALL_LOG: callLog },
      hooks: rowHooks,
    })
    .returning();
  await mcp.sync();
  return row;
}

async function task(name: string, prompt: string) {
  const [row] = await client.db.insert(tables.tasks).values({ name, prompt }).returning();
  return row;
}

const write = (uri: string, title?: string, id = "call-1") =>
  toolCall("echo__write", JSON.stringify({ uri, ...(title ? { title } : {}) }), id);

const artifactsOf = (runId: string) =>
  client.db.select().from(tables.runArtifacts).where(eq(tables.runArtifacts.runId, runId));

test("a link is captured with its step, its lastModified and its webUrl", async () => {
  const server = await echoServer();
  const { id: taskId } = await task("notes", "write the notes");
  replies = [write("doc://notes/a.md", "Notes A"), completion("written")];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");

  const [step] = await client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, run.id));
  const rows = await artifactsOf(run.id);
  // The second link the tool answered with is for the model alone, and is not the host's.
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    runId: run.id,
    runStepId: step.id,
    taskId,
    serverId: server.id,
    serverSlug: "echo",
    tool: "write",
    uri: "doc://notes/a.md",
    name: "a.md",
    title: "Notes A",
    mimeType: "text/markdown",
    description: "a document the echo server wrote",
    lastModified: new Date("2026-11-01T12:00:00Z"),
    webUrl: "https://echo.test/view?uri=doc://notes/a.md",
    count: 1,
  });
  // A watcher is told as it happens, as its own kind rather than inside the tool result.
  expect(history(run.id).filter((event) => event.kind === "artifact")).toMatchObject([
    { name: "echo__write", text: "Notes A", step: "notes" },
  ]);
});

test("two steps returning one uri make one row with count 2", async () => {
  await echoServer();
  const { id: taskId } = await task("notes", "write the notes");
  await client.db
    .insert(tables.steps)
    .values({ taskId, name: "revise", prompt: "revise them", position: 0 });
  replies = [
    write("doc://notes/a.md", "Draft"),
    completion("drafted"),
    write("doc://notes/a.md", "Final", "call-2"),
    completion("revised"),
  ];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");

  const steps = await client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, run.id));
  const first = steps.find((row) => row.position === 0);
  const rows = await artifactsOf(run.id);
  expect(rows).toHaveLength(1);
  // The latest title wins; the step that made it is still the one that first did.
  expect(rows[0]).toMatchObject({ count: 2, title: "Final", runStepId: first?.id });
  expect(rows[0].updatedAt.getTime()).toBeGreaterThanOrEqual(rows[0].createdAt.getTime());
});

test("a result with no links makes no row", async () => {
  await echoServer();
  const { id: taskId } = await task("pinger", "ping the echo server");
  replies = [toolCall("echo__ping"), completion("pong")];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");
  expect(await artifactsOf(run.id)).toEqual([]);
});

test("a hook call's link is not captured", async () => {
  await echoServer([
    { id: "file", on: "afterTurn", tool: "write", args: { uri: "doc://memory/{{session.id}}" } },
  ]);
  const { id: taskId } = await task("quiet", "say something");
  replies = [completion("something")];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");
  await hooks.hooksSettled();
  // The hook did write, and its link came back to the pool: it is the run that never saw it.
  expect(fs.readFileSync(callLog, "utf8")).toContain(`doc://memory/${run.id}`);
  expect(await artifactsOf(run.id)).toEqual([]);
});

test("deleting the run removes its artifacts", async () => {
  await echoServer();
  const { id: taskId } = await task("notes", "write the notes");
  replies = [write("doc://notes/a.md"), completion("written")];

  const run = await runner.runTask(taskId);
  expect(await artifactsOf(run.id)).toHaveLength(1);

  const { errors } = await graphql({
    schema,
    source: `mutation ($id: String!) { deleteRun(where: { id: { eq: $id } }) { id } }`,
    variableValues: { id: run.id },
  });
  expect(errors).toBeUndefined();
  expect(await artifactsOf(run.id)).toEqual([]);
});

/**
 * The runs page's own documents, printed rather than retyped, so the test cannot drift from what
 * the browser sends: the card's count, the opened run's Outputs, and Preview reading one back.
 */
test("the runs page counts a run's outputs, lists them in order, and previews one", async () => {
  const server = await echoServer();
  const { id: taskId } = await task("notes", "write the notes");
  replies = [
    write("doc://notes/a.md", "Notes A"),
    write("doc://notes/b.md", undefined, "call-2"),
    completion("written"),
  ];
  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");

  const list = await graphql({
    schema,
    source: print(RunsDocument),
    variableValues: { limit: 10 },
  });
  expect(list.errors).toBeUndefined();
  expect(list.data?.runs).toMatchObject([{ id: run.id, artifactsAggregate: { count: 2 } }]);

  const detail = await graphql({
    schema,
    source: print(RunDetailDocument),
    variableValues: { id: run.id },
  });
  expect(detail.errors).toBeUndefined();
  const [opened] = (detail.data?.runs ?? []) as { artifacts: Record<string, unknown>[] }[];
  expect(opened.artifacts).toMatchObject([
    { uri: "doc://notes/a.md", title: "Notes A", serverId: server.id, serverSlug: "echo" },
    { uri: "doc://notes/b.md", title: "", name: "b.md", count: 1 },
  ]);

  const preview = await graphql({
    schema,
    source: print(McpResourceDocument),
    variableValues: { serverId: server.id, uri: "doc://notes/a.md" },
  });
  expect(preview.errors).toBeUndefined();
  expect(preview.data?.mcpResource).toMatchObject({
    mimeType: "text/markdown",
    text: "# doc://notes/a.md\n\nRead back from the echo server.",
  });
});
