import * as events from "@cubicecho/agent-core";
import { type ExecutionResult, parse, subscribe } from "graphql";
import { beforeAll, beforeEach, expect, test } from "vitest";
import { dataDir } from "./helpers.ts";

// Importing the schema builds it against the live tables, so give the database a home first.
dataDir("events");

let schema: import("graphql").GraphQLSchema;

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  schema = (await import("../server/graphql/schema.ts")).schema;
});

beforeEach(() => events.resetEvents());

/** Reads `count` events off a subscription, so a test never waits on one that will not come. */
async function take<T>(iterator: AsyncIterator<T>, count: number): Promise<T[]> {
  const taken: T[] = [];
  for (let i = 0; i < count; i++) {
    const next = await iterator.next();
    if (next.done) {
      break;
    }
    taken.push(next.value);
  }
  return taken;
}

// The bus is agent-core's and its own suite holds it: numbering, the backlog a late watcher is
// handed, the stream ending at `done`, folding. What is tested here is the one case that suite
// does not ask of a live watcher, and the subscription that is this server's.
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
  if (!(Symbol.asyncIterator in result)) {
    throw new Error("expected a subscription stream");
  }
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
