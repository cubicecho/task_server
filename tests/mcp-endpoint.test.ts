import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { afterAll, beforeAll, expect, test } from "vitest";

// The endpoint serves the real schema, which is built against the live tables.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-mcp-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let events: typeof import("../server/runner/events.ts");
let server: Server;
let endpoint: URL;
let client: Client;

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  events = await import("../server/runner/events.ts");
  const { mountMcp } = await import("../server/mcp-endpoint.ts");

  // The same mount the server uses, so what a client meets here is what it meets in production.
  const app = express();
  mountMcp(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  endpoint = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);

  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(endpoint));
});

afterAll(async () => {
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Tools answer with the GraphQL envelope as JSON text; this is the `data` half of it. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const { text } = await raw(name, args);
  // Not every failure arrives as an envelope: an argument the driver rejects comes back as a bare
  // `MCP error -32602: …` string. Parsing that blind reports a `SyntaxError` about a stray `M`,
  // which says nothing about the call that actually went wrong.
  let envelope: { data?: Record<string, unknown>; errors?: unknown };
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error(`${name} did not answer with an envelope: ${text}`);
  }
  if (envelope.errors) throw new Error(`${name}: ${JSON.stringify(envelope.errors)}`);
  return envelope.data ?? {};
}

/** The result as the client meets it, for the calls that are meant to fail. */
async function raw(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const [content] = result.content;
  if (content?.type !== "text") throw new Error(`no text in the result of ${name}`);
  return { isError: result.isError === true, text: content.text };
}

/** A node of a tool's JSON Schema, as far as reaching the keys of its `where` argument needs. */
interface SchemaNode {
  $ref?: string;
  anyOf?: SchemaNode[];
  properties?: Record<string, SchemaNode>;
  definitions?: Record<string, SchemaNode>;
  $defs?: Record<string, SchemaNode>;
}

/**
 * The property names of a `where` argument, whichever shape the driver rendered it in.
 *
 * zod decides where a shared object lands and the two majors disagree: v3 writes it inline, v4
 * hoists it into `definitions` and leaves a `$ref`. Both are correct JSON Schema and neither is
 * this repo's choice, so the test follows a pointer rather than asserting a layout.
 */
function whereKeys(root: SchemaNode): string[] {
  const defs = root.definitions ?? root.$defs ?? {};
  const deref = (node: SchemaNode | undefined, depth = 0): SchemaNode | undefined => {
    if (!node || depth > 8) return node;
    if (node.$ref)
      return deref(defs[node.$ref.replace(/^#\/(definitions|\$defs)\//, "")], depth + 1);
    // A nullable argument is `anyOf: [the type, null]`; the type is the half with content.
    if (node.anyOf)
      return deref(
        node.anyOf.find((branch) => branch.$ref ?? branch.properties),
        depth + 1,
      );
    return node;
  };
  return Object.keys(deref(root.properties?.where)?.properties ?? {});
}

test("offers the task tools, and only those", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();

  // snake_case: the driver renames after it filters, so `include` names the GraphQL field and
  // this names the tool. The two spellings are the same seventeen root fields.
  expect(names).toEqual([
    "create_task",
    "create_trigger",
    "delete_task_single",
    "delete_trigger_single",
    "models",
    "run_events",
    "run_steps",
    "run_task",
    "runs",
    "schedule",
    "set_task_steps",
    "steps",
    "stop_task",
    "tasks",
    "triggers",
    "update_task_single",
    "update_trigger_single",
  ]);
  // The settings row holds the API key, and a bulk delete with no `where` empties a table.
  expect(names).not.toContain("set_api_key");
  expect(names).not.toContain("settings");
  expect(names).not.toContain("delete_task");
});

test("advertises tools small enough for a client to read", async () => {
  const { tools } = await client.listTools();

  // Every tool definition a client is handed, before it can call anything, and the whole reason
  // this is asserted: the generated `where` reaches through relations — a task filtered by its
  // runs, each run filtered back by its task — and the same filter types are reached by dozens of
  // routes. A driver that rebuilds them per route writes that recursion out at every level rather
  // than emitting a `$ref`, which put the seventeen tools at 18 MB and `tasks` alone at 2.8 MB —
  // more than any model will read, and it lands before a single call can be made.
  //
  // Shared, the listing is ~419 kB, the largest tool ~48 kB. The bounds sit well above that
  // because the exact figure is not ours to hold: it went to ~528 kB when zod 4 became the
  // conversion path and back again on 2.2.0. What is being caught here is the order of
  // magnitude — a return to per-route copies trips this by 30×.
  const sizes = tools.map((tool) => [tool.name, JSON.stringify(tool).length] as const);
  for (const [name, size] of sizes) {
    expect(size, `${name} is ${(size / 1024).toFixed(0)} kB`).toBeLessThan(100_000);
  }
  expect(sizes.reduce((total, [, size]) => total + size, 0)).toBeLessThan(650_000);

  // Both halves of what an agent filters on: the columns, and the relations reaching the
  // neighbouring tables. Filtering tasks by a property of their runs is a real question to ask.
  const input = tools.find((tool) => tool.name === "tasks")?.inputSchema as SchemaNode;
  expect(whereKeys(input)).toEqual([
    "id",
    "name",
    "prompt",
    "model",
    "systemPrompt",
    "enabled",
    "createdAt",
    "updatedAt",
    "triggers",
    "steps",
    "runs",
    "OR",
    "AND",
    "NOT",
  ]);
});

test("writes a task, reads it back, and deletes it", async () => {
  const created = (await call("create_task", {
    values: { name: "from mcp", prompt: "say hello" },
  })) as { createTask: { id: string; name: string } };
  const id = created.createTask.id;
  expect(created.createTask.name).toBe("from mcp");

  const listed = (await call("tasks", { where: { id: { eq: id } } })) as {
    tasks: { id: string; prompt: string }[];
  };
  expect(listed.tasks).toHaveLength(1);
  expect(listed.tasks[0].prompt).toBe("say hello");

  await call("update_task_single", { where: { id: { eq: id } }, set: { enabled: false } });
  const trigger = (await call("create_trigger", {
    values: { taskId: id, kind: "cron", cron: "0 9 * * *" },
  })) as { createTrigger: { id: string } };
  expect(trigger.createTrigger.id).toBeTruthy();

  // Nothing has run, so `runs` is empty for it rather than missing.
  const runs = (await call("runs", { where: { taskId: { eq: id } } })) as { runs: unknown[] };
  expect(runs.runs).toEqual([]);

  await call("delete_task_single", { where: { id: { eq: id } } });
  const gone = (await call("tasks", { where: { id: { eq: id } } })) as { tasks: unknown[] };
  expect(gone.tasks).toEqual([]);
});

test("filters a task by a property of its triggers", async () => {
  const created = (await call("create_task", {
    values: { name: "webhooked", prompt: "wait for a POST" },
  })) as { createTask: { id: string } };
  const id = created.createTask.id;
  await call("create_trigger", {
    values: { taskId: id, kind: "event", event: "hook-filter-test" },
  });

  // A relation filter, which is the reach the tools' `where` costs its size to keep: the answer
  // is a task, and the question is about its triggers.
  const found = (await call("tasks", {
    where: { triggers: { some: { event: { eq: "hook-filter-test" } } } },
  })) as { tasks: { id: string }[] };
  expect(found.tasks.map((task) => task.id)).toEqual([id]);

  await call("delete_task_single", { where: { id: { eq: id } } });
});

test("hands a run's progress to a client that polls for it", async () => {
  events.reset();
  events.emit("run-mcp", { kind: "step", text: "step 1" });
  for (const piece of ["think", "ing ", "out ", "loud"]) {
    events.emit("run-mcp", { kind: "thinking", text: piece });
  }
  events.emit("run-mcp", { kind: "tool-call", name: "echo__ping", text: "{}" });

  const first = (await call("run_events", { runId: "run-mcp" })) as {
    runEvents: { seq: number; kind: string; text: string }[];
  };
  // Four thinking deltas are one thought: a client reading in snapshots gets prose, not tokens.
  expect(first.runEvents.map((event) => event.kind)).toEqual(["step", "thinking", "tool-call"]);
  expect(first.runEvents[1].text).toBe("thinking out loud");

  const last = first.runEvents[first.runEvents.length - 1].seq;
  events.emit("run-mcp", { kind: "done", ok: true, text: "finished" });
  const next = (await call("run_events", { runId: "run-mcp", afterSeq: last })) as {
    runEvents: { kind: string; text: string }[];
  };
  // Resuming from the last `seq` reads what came after it, and nothing twice.
  expect(next.runEvents).toEqual([expect.objectContaining({ kind: "done", text: "finished" })]);
});

test("answers the whole transport, not just the calls", async () => {
  // A client that opens the notification stream, or asks to end its session, must meet the
  // transport rather than Express's 404 — which would read as "wrong URL" instead of "nothing
  // to say". Nothing is ever sent on this stream: the endpoint is stateless.
  const opened = await fetch(endpoint, { headers: { accept: "text/event-stream" } });
  expect(opened.status).toBe(200);
  expect(opened.headers.get("content-type")).toContain("text/event-stream");
  // Cancelled rather than aborted: aborting the request rejects the body stream nobody is
  // reading, and an unhandled rejection there takes the whole vitest worker down with it.
  await opened.body?.cancel();

  expect((await fetch(endpoint, { method: "DELETE" })).status).toBe(200);

  // And it says what is wrong in JSON-RPC, which is what a client knows how to read.
  const wrong = await fetch(endpoint);
  expect(wrong.status).toBe(406);
  expect(await wrong.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 } });
});

test("rejects an argument it does not recognise instead of dropping it", async () => {
  // The README promises this, and it is the driver's behaviour rather than ours — it changed once
  // already, in the other direction, and a silent revert would let a misspelled key through as a
  // success with that part of the write quietly discarded.
  const misspelled = await raw("tasks", { wehre: { id: { eq: "x" } } });
  expect(misspelled.isError).toBe(true);
  expect(misspelled.text).toContain("wehre");

  // The shape of a rejection is the driver's to choose and is not asserted here: today the body is
  // a bare `MCP error …` string rather than the `{ errors: [...] }` envelope a success uses.
  // What has to hold is that the call fails and names the key that made it fail.
  const badType = await raw("tasks", { limit: "ten" });
  expect(badType.isError).toBe(true);
  expect(badType.text).toContain("limit");
});

test("marks only the tools that actually destroy something", async () => {
  const { tools } = await client.listTools();
  const destructive = tools
    .filter((tool) => tool.annotations?.destructiveHint)
    .map((tool) => tool.name)
    .sort();

  // The updates rewrite a row, `set_task_steps` replaces a whole flow, and the deletes are the
  // real thing. Creating a task or starting a run is none of those, and a client that stops to
  // ask the operator should be spending that interruption on the deletes.
  expect(destructive).toEqual([
    "delete_task_single",
    "delete_trigger_single",
    "set_task_steps",
    "update_task_single",
    "update_trigger_single",
  ]);

  // Overriding one hint must not cost the others: they are merged, not replaced.
  const created = tools.find((tool) => tool.name === "create_task");
  expect(created?.annotations?.title).toBe("Create Task");
  expect(created?.annotations?.readOnlyHint).toBe(false);

  // Reads stay reads.
  expect(tools.find((tool) => tool.name === "tasks")?.annotations?.readOnlyHint).toBe(true);
});
