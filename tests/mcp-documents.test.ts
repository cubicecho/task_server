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

// The document-driven surface, against the same live tables the generated one runs on.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-mcp-docs-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let server: Server;
let client: Client;

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  const { mountDocsMcp } = await import("../server/mcp/docs-endpoint.ts");

  const app = express();
  mountDocsMcp(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp-docs`),
    ),
  );
});

afterAll(async () => {
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The one field a tool selected, out of the envelope every tool answers in.
 *
 * An operation tool answers in the same `{ data, errors }` shape a generated one does, which is
 * the point of running these through the driver rather than hand-rolling a handler: the result
 * an agent reads back does not depend on which half of the surface it called, and a call the
 * argument guard rejects — which answers above any handler — is not a second shape to learn.
 * Each of these documents has exactly one root field, so unwrapping it here is unambiguous.
 */
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  if (result.isError) throw new Error(`${name}: ${text}`);
  const { data, errors } = JSON.parse(text) as {
    data?: Record<string, unknown>;
    errors?: unknown;
  };
  if (errors) throw new Error(`${name}: ${JSON.stringify(errors)}`);
  const keys = Object.keys(data ?? {});
  return data?.[keys[0]];
}

test("every operation in tools.graphql becomes a tool", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "create_task",
    "create_trigger",
    "delete_task",
    "delete_trigger",
    "get_run",
    "get_run_events",
    "get_schedule",
    "get_task",
    "list_models",
    "list_runs",
    "list_tasks",
    "run_task",
    "set_task_steps",
    "stop_task",
    "update_task",
    "update_trigger",
  ]);

  // The point of the exercise. The generated surface projects root fields, so an agent meets the
  // schema's `where`/`set`/`values` and the transitive closure of the filter types behind them —
  // ~155 kB of JSON Schema before it can call anything. An operation's variables are flat and
  // few, so this whole listing costs about what the largest single tool over there does, and
  // most of it is prose rather than machinery — ~60%, against ~9%.
  const sizes = tools.map((tool) => JSON.stringify(tool).length);
  expect(Math.max(...sizes)).toBeLessThan(10_000);
  expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThan(30_000);

  // No filter object anywhere: an id is an id.
  expect(
    Object.keys(tools.find((tool) => tool.name === "get_task")?.inputSchema.properties ?? {}),
  ).toEqual(["id"]);
});

test("a task is written, read back and deleted without a filter", async () => {
  const created = (await call("create_task", {
    name: "from documents",
    prompt: "say hello",
  })) as { id: string; name: string };
  expect(created.name).toBe("from documents");

  const read = (await call("get_task", { id: created.id })) as { prompt: string };
  expect(read.prompt).toBe("say hello");

  const listed = (await call("list_tasks")) as { id: string }[];
  expect(listed.map((task) => task.id)).toContain(created.id);

  await call("delete_task", { id: created.id });
  expect(await call("get_task", { id: created.id })).toBeNull();
});

test("only the arguments sent are changed", async () => {
  const created = (await call("create_task", { name: "partial", prompt: "original" })) as {
    id: string;
  };
  const updated = (await call("update_task", { id: created.id, enabled: false })) as {
    enabled: boolean;
  };
  expect(updated.enabled).toBe(false);
  expect(((await call("get_task", { id: created.id })) as { prompt: string }).prompt).toBe(
    "original",
  );
  await call("delete_task", { id: created.id });
});

test("a run that cannot start, and an argument that never gets that far, read alike", async () => {
  // The two failures an agent actually meets, and the reason not to hand-roll the handler: one
  // comes from a resolver and one from the argument guard above it, and they arrive in the same
  // envelope with the same key to read. A surface that answers a sentence on the first and an
  // error array on the second is asking a caller to parse two ways and guess which it got.
  const refused = (await client.callTool({
    name: "run_task",
    arguments: { taskId: "no-such-task" },
  })) as CallToolResult;
  expect(refused.isError).toBe(true);
  const refusedText = refused.content[0]?.type === "text" ? refused.content[0].text : "";
  expect(JSON.parse(refusedText).errors[0].message).toContain("no-such-task");

  const malformed = (await client.callTool({ name: "get_task", arguments: {} })) as CallToolResult;
  expect(malformed.isError).toBe(true);
  const malformedText = malformed.content[0]?.type === "text" ? malformed.content[0].text : "";
  const [issue] = JSON.parse(malformedText).errors;
  expect(issue.message).toContain("id");
  // `BAD_INPUT`, the code the driver puts on an argument it rejected, which is the difference
  // between "fix the arguments and call again" and "this call will never work".
  expect(issue.extensions.code).toBe("BAD_INPUT");
});

test("a flow is written nested and read back flat", async () => {
  const task = (await call("create_task", { name: "flow", prompt: "start" })) as { id: string };
  await call("set_task_steps", {
    taskId: task.id,
    steps: [
      {
        kind: "decision",
        name: "worth it",
        prompt: "is it?",
        cases: ["yes", "no"],
        branches: [{ case: "yes", steps: [{ name: "do it", prompt: "go" }] }],
      },
    ],
  });

  const { steps } = (await call("get_task", { id: task.id })) as {
    steps: { name: string; branch: string }[];
  };
  expect(steps.map((step) => [step.name, step.branch])).toEqual([
    ["worth it", ""],
    ["do it", "yes"],
  ]);
  await call("delete_task", { id: task.id });
});
