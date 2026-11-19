import fs from "node:fs";
import path from "node:path";
import { history, UNTRUSTED_PREFACE } from "@cubicecho/agent-core";
import { type GraphQLSchema, graphql } from "graphql";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { type ChatBody, completion, replyWith, userPrompt } from "./fixtures/sse.ts";
import { dataDir, ECHO_FIXTURE, type FakeModel, fakeModel, useModel } from "./helpers.ts";

/**
 * `{{resource:<slug>:<uri>}}` in a prompt, read on every run against a real stdio server.
 *
 * A read reaches the server and nothing else on the run's side says it happened, so the fixture
 * writes each uri it is asked for to a log, and that log is the witness that a second run read
 * the resource again rather than reusing the first run's copy.
 */

const dir = dataDir("prompt-resources");
const readLog = path.join(dir, "reads.log");

let requests: ChatBody[] = [];
let replies: string[] = [];
let model: FakeModel;

let client: typeof import("../server/db/client.ts");
let tables: typeof import("../server/db/schema.ts");
let runner: typeof import("../server/runner/run.ts");
let mcp: typeof import("../server/runner/mcp.ts")["mcp"];
let cron: typeof import("../server/scheduler/cron.ts");
let flow: typeof import("../server/runner/flow.ts");
let limits: typeof import("../server/runner/prompt-resources.ts");
let schema: GraphQLSchema;

const reads = () =>
  fs.existsSync(readLog) ? fs.readFileSync(readLog, "utf8").trim().split("\n").filter(Boolean) : [];

const systemPrompt = (body: ChatBody) =>
  body.messages.find((message) => message.role === "system")?.content ?? "";

/** The echo server, serving resources, under `slug`. */
async function echoServer(slug = "echo") {
  const [row] = await client.db
    .insert(tables.mcpServers)
    .values({
      slug,
      label: slug,
      command: process.execPath,
      args: [ECHO_FIXTURE],
      env: { MCP_ECHO_RESOURCES: "1", MCP_ECHO_COMPLETIONS: "1", MCP_ECHO_READ_LOG: readLog },
    })
    .returning();
  await mcp.sync();
  return row;
}

async function task(prompt: string, agentId?: string) {
  const [row] = await client.db
    .insert(tables.tasks)
    .values({ name: "digest", prompt, agentId: agentId ?? null })
    .returning();
  return row;
}

async function stepRows(runId: string) {
  const { asc, eq } = await import("drizzle-orm");
  return client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, runId))
    .orderBy(asc(tables.runSteps.position));
}

beforeAll(async () => {
  model = await fakeModel((body, response) => {
    requests.push(body);
    replyWith(response, completion(replies.shift() ?? "done"), body);
  });

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  client = await import("../server/db/client.ts");
  tables = await import("../server/db/schema.ts");
  runner = await import("../server/runner/run.ts");
  ({ mcp } = await import("../server/runner/mcp.ts"));
  cron = await import("../server/scheduler/cron.ts");
  flow = await import("../server/runner/flow.ts");
  limits = await import("../server/runner/prompt-resources.ts");
  ({ schema } = await import("../server/graphql/schema.ts"));
  await useModel(model);
});

beforeEach(() => {
  requests = [];
  replies = [];
});

afterEach(async () => {
  await mcp.shutdown();
  await client.db.delete(tables.tasks);
  await client.db.delete(tables.agents);
  await client.db.delete(tables.mcpServers);
  fs.rmSync(readLog, { force: true });
});

afterAll(async () => {
  cron.stop();
  await model.close();
});

test("a named resource is read on every run, fenced as untrusted where it was named", async () => {
  await echoServer();
  const { id } = await task(
    "Summarise this:\n\n{{resource:echo:doc://notes/weekly.md}}\n\nBriefly.",
  );

  const first = await runner.runTask(id);
  const second = await runner.runTask(id);
  expect([first.status, second.status]).toEqual(["ok", "ok"]);

  // Read again by the second run, not reused from the first: the point of naming it.
  expect(reads()).toEqual(["doc://notes/weekly.md", "doc://notes/weekly.md"]);

  const prompt = userPrompt(requests[0]);
  expect(prompt).toContain(
    '<untrusted source="echo:doc://notes/weekly.md">\n# doc://notes/weekly.md\n\nRead back from the echo server.\n</untrusted>',
  );
  expect(prompt.startsWith("Summarise this:")).toBe(true);
  expect(prompt.endsWith("Briefly.")).toBe(true);
  expect(prompt).not.toContain("{{resource:");
  // The standing rule about what a fence means goes with it.
  expect(systemPrompt(requests[0])).toContain(UNTRUSTED_PREFACE);

  const [row] = await stepRows(second.id);
  expect(row.resources).toEqual([
    {
      server: "echo",
      uri: "doc://notes/weekly.md",
      readAt: expect.any(String),
      chars: "# doc://notes/weekly.md\n\nRead back from the echo server.".length,
      truncated: false,
      mimeType: "text/markdown",
    },
  ]);
});

test("a step with no resource in its prompt is sent no fence rule and records no reads", async () => {
  await echoServer();
  const { id } = await task("Just say hi.");

  const run = await runner.runTask(id);
  expect(run.status).toBe("ok");
  expect(systemPrompt(requests[0])).not.toContain(UNTRUSTED_PREFACE);
  expect((await stepRows(run.id))[0].resources).toBeNull();
});

test("a resource named twice in one prompt is read once and put in both places", async () => {
  await echoServer();
  const { id } = await task(
    "{{resource:echo:doc://a.md}} and again {{ resource:echo:doc://a.md }}",
  );

  await runner.runTask(id);
  expect(reads()).toEqual(["doc://a.md"]);
  expect(userPrompt(requests[0]).match(/<untrusted /g)).toHaveLength(2);
});

test("a read that fails fails the step with the reason, and the model is never asked", async () => {
  await echoServer();
  const { id } = await task(
    "Use {{resource:echo:doc://ok.md}} and {{resource:echo:missing://gone}}",
  );

  const run = await runner.runTask(id);
  expect(run.status).toBe("error");
  expect(requests).toHaveLength(0);

  const [row] = await stepRows(run.id);
  expect(row.status).toBe("error");
  expect(row.error).toMatch(
    /^Could not read \{\{resource:echo:missing:\/\/gone\}\}: .*no resource/,
  );
  // Both reads are kept — the one that worked is still part of why the step went as it did.
  expect(row.resources).toMatchObject([
    { uri: "doc://ok.md", truncated: false },
    { uri: "missing://gone", error: row.error },
  ]);
});

test("a server outside the profile's scope fails the step as a server that is not there", async () => {
  const echo = await echoServer();
  const other = await echoServer("other");
  const [agent] = await client.db
    .insert(tables.agents)
    .values({ name: "narrow", mcpServerIds: [other.id] })
    .returning();

  const outside = await runner.runTask((await task("{{resource:echo:doc://a.md}}", agent.id)).id);
  const unknown = await runner.runTask((await task("{{resource:nope:doc://a.md}}", agent.id)).id);
  expect([outside.status, unknown.status]).toEqual(["error", "error"]);
  expect(reads()).toEqual([]);

  // In the same words, so a task an agent wrote cannot learn which servers exist beyond its own.
  const [outsideRow] = await stepRows(outside.id);
  const [unknownRow] = await stepRows(unknown.id);
  expect(outsideRow.error).toBe(
    "Could not read {{resource:echo:doc://a.md}}: no MCP server by that slug is one this run can reach.",
  );
  expect(unknownRow.error.replace("nope", "echo")).toBe(outsideRow.error);

  // And the server the profile does reach is read as usual.
  const inside = await runner.runTask((await task("{{resource:other:doc://a.md}}", agent.id)).id);
  expect(inside.status).toBe("ok");
  expect(echo.id).not.toBe(other.id);
});

test("a read past the cap is cut, the watcher is told, and the record says so", async () => {
  await echoServer();
  const { id } = await task("{{resource:echo:big://dump}}");

  const run = await runner.runTask(id);
  expect(run.status).toBe("ok");

  const [row] = await stepRows(run.id);
  const [read] = row.resources ?? [];
  expect(read).toMatchObject({ uri: "big://dump", truncated: true });
  // At most the cap, marker included; the cut keeps a head and a tail around it.
  expect(read.chars).toBeLessThanOrEqual(limits.RESOURCE_MAX_CHARS);
  expect(read.chars).toBeGreaterThan(limits.RESOURCE_MAX_CHARS - 100);
  expect(userPrompt(requests[0]).length).toBeLessThan(limits.RESOURCE_MAX_CHARS + 200);
  expect(
    history(run.id).some(
      (event) => event.kind === "notice" && event.text?.includes("big://dump was cut"),
    ),
  ).toBe(true);
});

test("a placeholder in an earlier step's output is passed on as text, never read", async () => {
  await echoServer();
  const { id: taskId } = await task("first");
  await client.db
    .insert(tables.steps)
    .values({ taskId, name: "second", prompt: "Go on from {{previous}}", position: 0 });
  replies = ["{{resource:echo:doc://secret.md}}", "done"];

  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");
  expect(reads()).toEqual([]);
  expect(userPrompt(requests[1])).toBe("Go on from {{resource:echo:doc://secret.md}}");
});

test("a resource placeholder does not take the place of the earlier steps' preamble", () => {
  const rendered = flow.renderPrompt(
    { prompt: "Compare with {{resource:echo:doc://a.md}}", context: "all" },
    [{ name: "scan", output: "three errors" }],
    undefined,
    new Map([["echo:doc://a.md", "<untrusted>A</untrusted>"]]),
  );
  expect(rendered).toBe(
    "## Earlier in this task\n\n### scan\n\nthree errors\n\n---\n\nCompare with <untrusted>A</untrusted>",
  );
});

test("the picker lists resources and templates, and completes a template's variables", async () => {
  const echo = await echoServer();

  const listed = await graphql({
    schema,
    source: `{ mcpResources { server serverSlug serverLabel template uri name title description mimeType } }`,
  });
  expect(listed.errors).toBeUndefined();
  expect(listed.data?.mcpResources).toEqual([
    {
      server: echo.id,
      serverSlug: "echo",
      serverLabel: "echo",
      template: false,
      uri: "doc://notes/plan.md",
      name: "plan.md",
      title: "The plan",
      description: "",
      mimeType: "text/markdown",
    },
    {
      server: echo.id,
      serverSlug: "echo",
      serverLabel: "echo",
      template: true,
      uri: "doc://{+path}",
      name: "doc",
      title: "",
      description: "Any document, by its path",
      mimeType: "text/markdown",
    },
  ]);

  const completed = await graphql({
    schema,
    source: `query ($server: String!) {
      mcpResourceCompletion(server: $server, uri: "doc://{+path}", variable: "path", value: "notes/w")
    }`,
    variableValues: { server: echo.id },
  });
  expect(completed.errors).toBeUndefined();
  expect(completed.data?.mcpResourceCompletion).toEqual(["notes/weekly.md"]);
});

test("a placeholder the picker writes is the one the runner reads, colons in the uri and all", async () => {
  const { expandTemplate, templateVariables } = await import("@/lib/resource-template");
  const { resourcePlaceholder, resourceRefs } = await import("../shared/resource-placeholder.ts");

  expect(templateVariables("ragdown://{collection}/{+path}")).toEqual(["collection", "path"]);
  const uri = expandTemplate("ragdown://{collection}/{+path}", {
    collection: "notes",
    path: "2026/week 45.md",
  });
  expect(uri).toBe("ragdown://notes/2026/week%2045.md");

  const prompt = `Read ${resourcePlaceholder({ server: "ragdown", uri })} and ${resourcePlaceholder({ server: "db", uri: "pg://host:5432/x" })}`;
  expect(resourceRefs(prompt)).toEqual([
    { server: "ragdown", uri },
    { server: "db", uri: "pg://host:5432/x" },
  ]);
});
