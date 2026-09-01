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
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const [content] = result.content;
  if (content?.type !== "text") throw new Error(`no text in the result of ${name}`);
  const envelope = JSON.parse(content.text) as { data?: Record<string, unknown>; errors?: unknown };
  if (envelope.errors) throw new Error(`${name}: ${JSON.stringify(envelope.errors)}`);
  return envelope.data ?? {};
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
