import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { completion, replyWith, toolCall } from "./fixtures/sse.ts";
import { dataDir, ECHO_FIXTURE, type FakeModel, fakeModel, until, useModel } from "./helpers.ts";

/**
 * A stop reaches the tool call the run is waiting on, and not only the model.
 *
 * The fixture's `slow` tool waits a minute unless it is cancelled, and writes down the
 * cancellation it received: what the server was told is visible from the server alone.
 */

const dir = dataDir("tool-stop");

const callLog = path.join(dir, "calls.log");
const cancelLog = path.join(dir, "cancels.log");

let model: FakeModel;
const replies = [toolCall("echo__slow"), completion("too late")];

let runner: typeof import("../server/runner/run.ts");
let mcp: typeof import("../server/runner/mcp.ts")["mcp"];
let cron: typeof import("../server/scheduler/cron.ts");
let taskId = "";

const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");

beforeAll(async () => {
  model = await fakeModel((body, response) => {
    replyWith(response, replies.shift() ?? completion(""), body);
  });

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  const { db } = await import("../server/db/client.ts");
  const tables = await import("../server/db/schema.ts");
  runner = await import("../server/runner/run.ts");
  ({ mcp } = await import("../server/runner/mcp.ts"));
  cron = await import("../server/scheduler/cron.ts");
  await useModel(model);

  await db.insert(tables.mcpServers).values({
    slug: "echo",
    label: "Echo",
    command: process.execPath,
    args: [ECHO_FIXTURE],
    env: { MCP_ECHO_SLOW: "1", MCP_ECHO_CALL_LOG: callLog, MCP_ECHO_CANCEL_LOG: cancelLog },
  });
  await mcp.sync();
  const [task] = await db.insert(tables.tasks).values({ name: "crawl", prompt: "go" }).returning();
  taskId = task.id;
});

afterAll(async () => {
  cron.stop();
  await mcp.shutdown();
  await model.close();
});

test("stopping a run cancels the tool call it is waiting on, and the server is told", async () => {
  const finished = runner.runTask(taskId);
  await until(() => read(callLog).includes('"slow"'));

  const stoppedAt = Date.now();
  expect(runner.stopTask(taskId)).toBe(true);
  const run = await finished;

  expect(run.status).toBe("stopped");
  // The tool would have answered in a minute. Dropping the signal kept the run waiting for it.
  expect(Date.now() - stoppedAt).toBeLessThan(2000);
  await until(() => read(cancelLog) !== "");
  // The model is never asked what to make of a result nobody wanted.
  expect(replies).toHaveLength(1);
});
