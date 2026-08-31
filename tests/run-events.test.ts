import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ExecutionResult, parse, subscribe } from "graphql";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

// Importing the schema builds it against the live tables, so give the database a home first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-events-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let events: typeof import("../server/runner/events.ts");
let schema: import("graphql").GraphQLSchema;

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  ensureSchema();
  events = await import("../server/runner/events.ts");
  schema = (await import("../server/graphql/schema.ts")).schema;
});

beforeEach(() => events.reset());

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Reads `count` events off a subscription, so a test never waits on one that will not come. */
async function take<T>(iterator: AsyncIterator<T>, count: number): Promise<T[]> {
  const taken: T[] = [];
  for (let i = 0; i < count; i++) {
    const next = await iterator.next();
    if (next.done) break;
    taken.push(next.value);
  }
  return taken;
}

test("a watcher joining late is told everything it missed, then follows along", async () => {
  events.emit("run-1", { kind: "turn", text: "turn 1" });
  events.emit("run-1", { kind: "thinking", text: "hmm" });

  const watcher = events.watch("run-1");
  const backlog = await take(watcher, 2);
  expect(backlog.map((event) => event.text)).toEqual(["turn 1", "hmm"]);
  // Numbered from one, so a client can order and de-duplicate what it is handed.
  expect(backlog.map((event) => event.seq)).toEqual([1, 2]);

  events.emit("run-1", { kind: "output", text: "hello" });
  const [live] = await take(watcher, 1);
  expect(live).toMatchObject({ kind: "output", text: "hello", seq: 3 });

  await watcher.return(undefined as never);
});

test("`done` ends the stream rather than leaving it open forever", async () => {
  const watcher = events.watch("run-2");
  events.emit("run-2", { kind: "output", text: "bye" });
  events.emit("run-2", { kind: "done", ok: true, text: "finished" });

  const seen = await take(watcher, 5);
  expect(seen.map((event) => event.kind)).toEqual(["output", "done"]);
  // The generator returned on its own; nothing is waiting on a run that has ended.
  expect((await watcher.next()).done).toBe(true);
});

test("events for one run are never handed to a watcher of another", async () => {
  const watcher = events.watch("run-3");
  events.emit("other", { kind: "output", text: "not yours" });
  events.emit("run-3", { kind: "done", ok: true, text: "finished" });

  const seen = await take(watcher, 5);
  expect(seen.map((event) => event.text)).toEqual(["finished"]);
});

test("the subscription carries a run over GraphQL", async () => {
  const result = await subscribe({
    schema,
    document: parse(`subscription { runEvents(runId: "run-4") { seq kind text name ok } }`),
  });
  if (!(Symbol.asyncIterator in result)) throw new Error("expected a subscription stream");
  const stream = result as AsyncIterableIterator<ExecutionResult>;

  events.emit("run-4", { kind: "tool-call", name: "echo__ping", text: "{}" });
  events.emit("run-4", { kind: "done", ok: true, text: "finished" });

  const payloads = await take(stream, 5);
  expect(payloads.map((payload) => payload.data?.runEvents)).toEqual([
    { seq: 1, kind: "tool-call", text: "{}", name: "echo__ping", ok: null },
    { seq: 2, kind: "done", text: "finished", name: "", ok: true },
  ]);
  expect((await stream.next()).done).toBe(true);
});

test("consecutive tokens fold into one entry, but never across a step boundary", () => {
  events.emit("run-5", { kind: "output", text: "he", step: "read" });
  events.emit("run-5", { kind: "output", text: "llo", step: "read" });
  events.emit("run-5", { kind: "step", name: "write", text: "agent" });
  events.emit("run-5", { kind: "output", text: "by", step: "write" });
  events.emit("run-5", { kind: "output", text: "e", step: "write" });

  const folded = events.fold(events.history("run-5"));
  expect(folded.map((event) => [event.kind, event.step, event.text])).toEqual([
    ["output", "read", "hello"],
    ["step", "", "agent"],
    ["output", "write", "bye"],
  ]);
  // Each block carries the seq of its last event, so a client that asks for what came after
  // one block picks up exactly where it left off.
  expect(folded.map((event) => event.seq)).toEqual([2, 3, 5]);
});
