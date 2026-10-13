import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type GraphQLSchema, graphql } from "graphql";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type FakeModel, hangingModel, until, useModel } from "./helpers.ts";

// Loading anything under server/ builds the schema against the live tables, so point the
// database somewhere disposable first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-stop-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let schema: GraphQLSchema;
let runner: typeof import("../server/runner/run.ts");
let cron: typeof import("../server/scheduler/cron.ts");
/** A model server that accepts the request and never answers, so the run stays in flight. */
let hang: FakeModel;
let taskId = "";

beforeAll(async () => {
  hang = await hangingModel();

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  schema = (await import("../server/graphql/schema.ts")).schema;
  runner = await import("../server/runner/run.ts");
  cron = await import("../server/scheduler/cron.ts");

  const { db } = await import("../server/db/client.ts");
  const { tasks } = await import("../server/db/schema.ts");
  await useModel(hang);
  const [task] = await db.insert(tasks).values({ name: "slow", prompt: "wait" }).returning();
  taskId = task.id;
});

afterAll(async () => {
  cron.stop();
  await hang.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const gql = (source: string, variableValues?: Record<string, unknown>) =>
  graphql({ schema, source, variableValues });

test("a running task cannot be deleted, but it can be stopped and then deleted", async () => {
  const finished = runner.runTask(taskId);
  // The run row is written before the agent starts, so this settles almost at once.
  await until(() => runner.runningTaskIds().has(taskId));

  const refused = await gql(
    `mutation D($id: String!) { deleteTask(where: { id: { eq: $id } }) { id } }`,
    {
      id: taskId,
    },
  );
  expect(refused.errors?.[0].message).toMatch(/running/i);
  // The rollback has to leave the task itself alone.
  const still = await gql(`{ tasks { id } }`);
  expect(still.data?.tasks).toHaveLength(1);

  // The run row is the one the runner is about to write the outcome to, so it is guarded too.
  const runs = await gql(`{ runs { id status } }`);
  const [inFlight] = (runs.data?.runs ?? []) as { id: string; status: string }[];
  const runId = inFlight.id;
  expect(inFlight.status).toBe("running");
  const runRefused = await gql(
    `mutation D($id: String!) { deleteRun(where: { id: { eq: $id } }) { id } }`,
    { id: runId },
  );
  expect(runRefused.errors?.[0].message).toMatch(/still going/i);

  // The run read the flow when it started and is recording what it executed against those very
  // rows, so editing them now would make its own account of itself lie.
  const stepsRefused = await gql(
    `mutation S($id: String!) { setTaskSteps(taskId: $id, steps: [{ prompt: "later" }]) { id } }`,
    { id: taskId },
  );
  expect(stepsRefused.errors?.[0].message).toMatch(/running/i);

  const stopped = await gql(`mutation S($id: String!) { stopTask(taskId: $id) }`, { id: taskId });
  expect(stopped.data?.stopTask).toBe(true);

  const run = await finished;
  expect(run.status).toBe("stopped");
  expect(run.error).toBeFalsy();
  expect(runner.runningTaskIds().has(taskId)).toBe(false);

  const runDeleted = await gql(
    `mutation D($id: String!) { deleteRun(where: { id: { eq: $id } }) { id } }`,
    { id: runId },
  );
  expect(runDeleted.errors).toBeUndefined();

  const deleted = await gql(
    `mutation D($id: String!) { deleteTask(where: { id: { eq: $id } }) { id } }`,
    {
      id: taskId,
    },
  );
  expect(deleted.errors).toBeUndefined();
  expect(deleted.data?.deleteTask).toMatchObject({ id: taskId });
});

test("stopping a task that is not running says so rather than failing", async () => {
  const result = await gql(`mutation S($id: String!) { stopTask(taskId: $id) }`, { id: "nobody" });
  expect(result.errors).toBeUndefined();
  expect(result.data?.stopTask).toBe(false);
});
