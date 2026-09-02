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

/** A tool's answer, parsed. Unlike the generated surface there is no envelope to open. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  if (result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
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
  // ~420 kB of JSON Schema before it can call anything. An operation's variables are flat and
  // few, so the whole listing here fits in what one generated tool costs, and most of what is
  // left is prose rather than machinery.
  const sizes = tools.map((tool) => JSON.stringify(tool).length);
  expect(Math.max(...sizes)).toBeLessThan(10_000);
  expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThan(30_000);

  // No filter object anywhere: an id is an id.
  expect(
    Object.keys(tools.find((tool) => tool.name === "get_task")?.inputSchema.properties ?? {}),
  ).toEqual(["id"]);
});

test("a task is written, read back and deleted without a filter", async () => {
  const created = await call("create_task", { name: "from documents", prompt: "say hello" });
  expect(created.name).toBe("from documents");

  // The answer is the row, not `{ data: { createTask: … } }`. A tool that names itself
  // `create_task` and then hands back a key called `createTask` is asking an agent to hold two
  // vocabularies at once.
  expect(created).not.toHaveProperty("data");

  const read = await call("get_task", { id: created.id });
  expect(read.prompt).toBe("say hello");

  const listed = await call("list_tasks");
  expect(listed.map((task: { id: string }) => task.id)).toContain(created.id);

  await call("delete_task", { id: created.id });
  expect(await call("get_task", { id: created.id })).toBeNull();
});

test("only the arguments sent are changed", async () => {
  const created = await call("create_task", { name: "partial", prompt: "original" });
  const updated = await call("update_task", { id: created.id, enabled: false });
  expect(updated.enabled).toBe(false);
  expect((await call("get_task", { id: created.id })).prompt).toBe("original");
  await call("delete_task", { id: created.id });
});

test("a failure is a sentence, not an error array", async () => {
  const result = (await client.callTool({
    name: "run_task",
    arguments: { taskId: "no-such-task" },
  })) as CallToolResult;
  expect(result.isError).toBe(true);
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  expect(text).toContain("no-such-task");

  // The whole answer, with nothing to unwrap. The generated surface hands back
  // `{"errors":[{"message":…,"path":[…],"locations":[…]}]}`, which asks an agent to know what a
  // GraphQL error document is before it can read what went wrong.
  expect(() => JSON.parse(text)).toThrow();
});

test("an argument the driver rejects still arrives in the driver's shape", async () => {
  // Not everything is ours to present. Argument validation happens above the handler — zod
  // checks the input schema and answers before any GraphQL runs — so a missing `id` comes back
  // as the driver's error envelope rather than a sentence. The message inside it is readable and
  // names the argument, which is most of the value, but the wrapper is a leak this approach does
  // not close on its own: it wants `isError` with plain text from the driver too.
  const result = (await client.callTool({ name: "get_task", arguments: {} })) as CallToolResult;
  expect(result.isError).toBe(true);
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  expect(JSON.parse(text).errors[0].message).toContain("id");
});

test("a flow is written nested and read back flat", async () => {
  const task = await call("create_task", { name: "flow", prompt: "start" });
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

  const steps = (await call("get_task", { id: task.id })).steps;
  expect(steps.map((step: { name: string; branch: string }) => [step.name, step.branch])).toEqual([
    ["worth it", ""],
    ["do it", "yes"],
  ]);
  await call("delete_task", { id: task.id });
});
