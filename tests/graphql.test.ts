import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type GraphQLSchema, graphql } from "graphql";
import { afterAll, beforeAll, expect, test } from "vitest";

// The schema is built from the live Drizzle tables at import time, so the database has to be
// pointed somewhere disposable before anything under server/ is loaded.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-test-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let schema: GraphQLSchema;
let cron: typeof import("../server/scheduler/cron.ts");

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  schema = (await import("../server/graphql/schema.ts")).schema;
  cron = await import("../server/scheduler/cron.ts");
});

afterAll(async () => {
  await cron.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function run(source: string, variableValues?: Record<string, unknown>) {
  const result = await graphql({ schema, source, variableValues });
  expect(result.errors).toBeUndefined();
  // biome-ignore lint/suspicious/noExplicitAny: assertions walk arbitrary GraphQL payloads.
  return result.data as Record<string, any>;
}

test("a task with a cron trigger lands on the schedule", async () => {
  const { createTask: task } = await run(
    `mutation { createTask(values: { name: "digest", prompt: "summarise" }) { id name } }`,
  );
  expect(task.name).toBe("digest");

  const { createTrigger: trigger } = await run(
    `mutation Create($taskId: String!) {
       createTrigger(values: { taskId: $taskId, cron: "0 9 * * *", timezone: "America/Chicago" }) {
         id kind
       }
     }`,
    { taskId: task.id },
  );
  expect(trigger.kind).toBe("cron");

  // The onWrite hook debounces its scheduler rebuild past the mutation's own transaction.
  await cron.sync();

  const { schedule } = await run(`{ schedule { triggerId taskId cron nextRun } }`);
  expect(schedule).toHaveLength(1);
  expect(schedule[0]).toMatchObject({ triggerId: trigger.id, taskId: task.id, cron: "0 9 * * *" });
  expect(Date.parse(schedule[0].nextRun)).toBeGreaterThan(Date.now());
});

test("disabling the task takes its triggers off the schedule with it", async () => {
  const { tasks } = await run(`{ tasks { id } }`);
  await run(
    `mutation Off($id: String!) { updateTask(set: { enabled: false }, where: { id: { eq: $id } }) { id } }`,
    {
      id: tasks[0].id,
    },
  );

  await cron.sync();
  const { schedule } = await run(`{ schedule { triggerId } }`);
  expect(schedule).toEqual([]);
});

test("a broken MCP config is reported, not thrown", async () => {
  const { testMcpServer } = await run(
    `mutation { testMcpServer(config: { transport: "stdio", command: "" }) { ok error tools { name } } }`,
  );
  // A test that cannot connect is a normal answer for this mutation — the point of the button
  // is to find out, so the reason belongs in the payload rather than in an errors array.
  expect(testMcpServer).toMatchObject({ ok: false, tools: [] });
  expect(testMcpServer.error).toMatch(/command/);

  const { testMcpServer: missing } = await run(
    `mutation { testMcpServer(config: { transport: "stdio", command: "definitely-not-a-real-binary" }) { ok error } }`,
  );
  expect(missing.ok).toBe(false);
  expect(missing.error).not.toBe("");
});

test("the api key is write-only", async () => {
  const result = await graphql({ schema, source: `{ settings { apiKey } }` });
  expect(result.errors?.[0].message).toMatch(/apiKey/);

  const { setApiKey } = await run(`mutation { setApiKey(apiKey: "sk-test") }`);
  expect(setApiKey).toBe(true);
});
