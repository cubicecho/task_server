import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type GraphQLSchema, graphql } from "graphql";
import { afterAll, beforeAll, expect, test } from "vitest";

// Loading anything under server/ builds the schema against the live tables, so point the
// database somewhere disposable first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-stop-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let schema: GraphQLSchema;
let runner: typeof import("../server/runner/run.ts");
let cron: typeof import("../server/scheduler/cron.ts");
/** A model server that accepts the request and never answers, so the run stays in flight. */
let hang: http.Server;
let taskId = "";

beforeAll(async () => {
  hang = http.createServer(() => {});
  await new Promise<void>((resolve) => hang.listen(0, "127.0.0.1", resolve));
  const address = hang.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const { ensureSchema } = await import("../server/db/migrate.ts");
  ensureSchema();
  schema = (await import("../server/graphql/schema.ts")).schema;
  runner = await import("../server/runner/run.ts");
  cron = await import("../server/scheduler/cron.ts");

  const { eq } = await import("drizzle-orm");
  const { db } = await import("../server/db/client.ts");
  const { settings, tasks } = await import("../server/db/schema.ts");
  await db
    .update(settings)
    .set({ baseUrl: `http://127.0.0.1:${port}/v1`, model: "fake" })
    .where(eq(settings.id, "default"));
  const [task] = await db.insert(tasks).values({ name: "slow", prompt: "wait" }).returning();
  taskId = task.id;
});

afterAll(async () => {
  cron.stop();
  await new Promise((resolve) => hang.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const gql = (source: string, variableValues?: Record<string, unknown>) =>
  graphql({ schema, source, variableValues });

test("a running task cannot be deleted, but it can be stopped and then deleted", async () => {
  const finished = runner.runTask(taskId);
  // The run row is written before the agent starts, so this settles almost at once.
  while (!runner.runningTaskIds().has(taskId)) await new Promise((r) => setTimeout(r, 5));

  const refused = await gql(
    `mutation D($id: String!) { deleteTaskSingle(where: { id: { eq: $id } }) { id } }`,
    {
      id: taskId,
    },
  );
  expect(refused.errors?.[0].message).toMatch(/running/i);
  // The rollback has to leave the task itself alone.
  const still = await gql(`{ tasks { id } }`);
  expect(still.data?.tasks).toHaveLength(1);

  const stopped = await gql(`mutation S($id: String!) { stopTask(taskId: $id) }`, { id: taskId });
  expect(stopped.data?.stopTask).toBe(true);

  const run = await finished;
  expect(run.status).toBe("stopped");
  expect(run.error).toBeFalsy();
  expect(runner.runningTaskIds().has(taskId)).toBe(false);

  const deleted = await gql(
    `mutation D($id: String!) { deleteTaskSingle(where: { id: { eq: $id } }) { id } }`,
    {
      id: taskId,
    },
  );
  expect(deleted.errors).toBeUndefined();
  expect(deleted.data?.deleteTaskSingle).toMatchObject({ id: taskId });
});

test("stopping a task that is not running says so rather than failing", async () => {
  const result = await gql(`mutation S($id: String!) { stopTask(taskId: $id) }`, { id: "nobody" });
  expect(result.errors).toBeUndefined();
  expect(result.data?.stopTask).toBe(false);
});
