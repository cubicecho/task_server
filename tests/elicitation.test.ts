import { history, resetEvents } from "@cubicecho/agent-core";
import { eq } from "drizzle-orm";
import { type GraphQLSchema, graphql, print } from "graphql";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { RunDetailDocument } from "../web/__generated__/graphql/graphql.ts";
import { type Completion, completion, replyWith, toolCall } from "./fixtures/sse.ts";
import { dataDir, ECHO_FIXTURE, type FakeModel, fakeModel, useModel } from "./helpers.ts";

/**
 * What a run does when an MCP server stops mid-call to ask for something: it declares that a
 * server may ask, declines every question, and keeps the question on the step — against a real
 * stdio server whose tool asks, so the answer the test reads is the one the server was sent.
 */

dataDir("elicitation");

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
  await client.db.insert(tables.mcpServers).values({
    slug: "echo",
    command: process.execPath,
    args: [ECHO_FIXTURE],
    env: { MCP_ECHO_ELICIT: "1" },
  });
  await mcp.sync();
});

beforeEach(() => {
  replies = [];
});

afterEach(async () => {
  resetEvents();
  await client.db.delete(tables.tasks);
});

afterAll(async () => {
  cron.stop();
  await mcp.shutdown();
  await model.close();
});

/** Runs a one-step task whose model makes `call` and then answers, and hands back its step. */
async function runCalling(name: string) {
  const [task] = await client.db
    .insert(tables.tasks)
    .values({ name: "asker", prompt: "write the file" })
    .returning();
  replies = [toolCall(name, "{}", "call-a"), completion("done")];
  const run = await runner.runTask(task.id);
  expect(run.status).toBe("ok");
  const [step] = await client.db
    .select()
    .from(tables.runSteps)
    .where(eq(tables.runSteps.runId, run.id));
  return { run, step };
}

test("a server that asks mid-call is answered decline, and the step keeps what it asked", async () => {
  const { run, step } = await runCalling("echo__ask");

  // The server heard a decline, not a refusal to offer: the SDK would not have sent the question
  // to a client that never declared elicitation, and the tool would have said so.
  const results = history(run.id).filter((event) => event.kind === "tool-result");
  expect(results.map((event) => event.text)).toEqual(["answered decline"]);

  expect(step.elicitations).toEqual([
    {
      tool: "echo__ask",
      server: "echo",
      message: "Which folder should I write to?",
      fields: ["folder", "overwrite"],
    },
  ]);

  // The watcher is told on the stream, in the step it happened in.
  const notices = history(run.id).filter((event) => event.kind === "notice");
  expect(notices).toContainEqual(
    expect.objectContaining({
      step: "asker",
      text:
        "server echo asked: Which folder should I write to? (fields: folder, overwrite) — " +
        "declined: task-server runs unattended",
    }),
  );

  // And the run page's query reads it back.
  const result = await graphql({
    schema,
    source: print(RunDetailDocument),
    variableValues: { id: run.id },
  });
  expect(result.errors).toBeUndefined();
  const [detail] = (result.data as { runs: { steps: { elicitations: unknown }[] }[] }).runs;
  expect(detail.steps[0].elicitations).toEqual(step.elicitations);
});

test("a step whose servers ask nothing keeps no elicitations", async () => {
  const { step } = await runCalling("echo__ping");

  expect(step.elicitations).toBeNull();
});
