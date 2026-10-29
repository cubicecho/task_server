import { exportCapabilities, resetAll } from "@cubicecho/agent-core";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { completion, replyWith } from "./fixtures/sse.ts";
import { dataDir, type FakeModel, fakeModel, useModel } from "./helpers.ts";

dataDir("capabilities");

let db: typeof import("../server/db/client.ts").db;
let tables: typeof import("../server/db/schema.ts");
let runner: typeof import("../server/runner/run.ts");
let store: typeof import("../server/runner/capabilities.ts");
let model: FakeModel;
let taskId = "";
/** Whether each chat request carried `stream_options`, in order. */
let asked: boolean[] = [];

beforeAll(async () => {
  // An endpoint that has not heard of `stream_options`, which is a refusal agent-core latches.
  model = await fakeModel((body, response) => {
    asked.push(!!body.stream_options);
    if (body.stream_options) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "unknown field: stream_options" } }));
      return;
    }
    replyWith(response, completion("done"), body);
  });

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  db = (await import("../server/db/client.ts")).db;
  tables = await import("../server/db/schema.ts");
  runner = await import("../server/runner/run.ts");
  store = await import("../server/runner/capabilities.ts");

  await useModel(model);
  const [task] = await db.insert(tables.tasks).values({ name: "t", prompt: "go" }).returning();
  taskId = task.id;
});

afterAll(async () => {
  await model.close();
});

beforeEach(async () => {
  asked = [];
  await db.delete(tables.endpointCapabilities);
  restart();
});

/** What a new process starts with: nothing latched, nothing known to be stored. */
function restart() {
  resetAll();
  store.forgetSaved();
}

const stored = async () => (await db.select().from(tables.endpointCapabilities))[0];

async function runOnce() {
  const run = await runner.runTask(taskId);
  expect(run.status).toBe("ok");
  // Chained behind the save the run's own `finally` started.
  await store.persistCapabilities();
}

test("a refusal learned before a restart is not paid for again after it", async () => {
  await runOnce();
  expect(asked).toEqual([true, false]);
  expect(JSON.stringify((await stored())?.snapshot)).toMatch(/"usageInStream":false/);

  restart();
  expect(await store.restoreCapabilities()).toBe(true);
  asked = [];
  await runOnce();

  expect(asked).toEqual([false]);
});

test("a run that learned nothing new writes nothing", async () => {
  await runOnce();
  const first = await stored();

  await runOnce();
  expect(await store.persistCapabilities()).toBe(false);
  expect((await stored())?.savedAt).toEqual(first?.savedAt);
});

test("a snapshot this version cannot read is ignored and then overwritten", async () => {
  await db.insert(tables.endpointCapabilities).values({ snapshot: { version: 999 } });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  expect(await store.restoreCapabilities()).toBe(false);
  expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not one this version reads/));
  warn.mockRestore();

  await runOnce();
  expect(asked).toEqual([true, false]);
  expect((await stored())?.snapshot).toMatchObject({ version: 1 });
});

test("a latch older than the maximum age is forgotten on restore", async () => {
  await runOnce();
  const snapshot = exportCapabilities();
  for (const endpoint of Object.values(snapshot.endpoints)) {
    endpoint.since = Date.now() - store.CAPABILITY_MAX_AGE_MS - 1000;
  }
  await db.update(tables.endpointCapabilities).set({ snapshot });

  restart();
  expect(await store.restoreCapabilities()).toBe(true);
  expect(exportCapabilities().endpoints).toEqual({});

  // The server is asked again, and the row is rewritten with the answer's new age.
  asked = [];
  await runOnce();
  expect(asked).toEqual([true, false]);
});

test("the snapshot is not in the generated API", async () => {
  const { schema } = await import("../server/graphql/schema.ts");
  const names = [
    ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
    ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
    ...Object.keys(schema.getTypeMap()),
  ];
  expect(names.filter((name) => /capabilit/i.test(name))).toEqual([]);
});
