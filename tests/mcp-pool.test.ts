import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import type { McpServerRow } from "../server/db/schema.ts";

// Loading the pool pulls in the database module, so give it somewhere disposable first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-mcp-pool-"));
process.env.TASK_SERVER_DATA_DIR = dir;

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-echo.mjs", import.meta.url));
const spawnLog = path.join(dir, "spawns.log");

/** The pid of every child the fixture has been started as, across every sync so far. */
const spawnedPids = (): number[] =>
  fs.existsSync(spawnLog)
    ? fs.readFileSync(spawnLog, "utf8").trim().split("\n").filter(Boolean).map(Number)
    : [];

const spawned = () => spawnedPids().length;

/** The qualified names on offer. A tool definition is a union; only the function arm is used here. */
const toolNames = () =>
  mcp.tools().flatMap((tool) => (tool.type === "function" ? [tool.function.name] : []));

/**
 * Which of these processes are still running, once they have had a moment to go.
 *
 * This is the only way to see the bug these tests are about: a client the pool dropped its
 * handle to still has a live child on the end of it, and nothing the pool reports mentions it.
 * Signal 0 asks the kernel whether a pid exists without sending anything to it.
 */
async function stillAlive(pids: number[]): Promise<number[]> {
  const alive = () =>
    pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  for (let attempt = 0; attempt < 40 && alive().length > 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return alive();
}

const config = (over: Partial<McpServerRow> = {}): McpServerRow => ({
  id: "echo-1",
  slug: "echo",
  label: "Echo",
  enabled: true,
  transport: "stdio",
  command: process.execPath,
  args: [FIXTURE],
  env: { MCP_ECHO_SPAWN_LOG: spawnLog },
  url: "",
  headers: null,
  ...over,
});

let mcp: typeof import("../server/runner/mcp.ts")["mcp"];
let db: typeof import("../server/db/client.ts")["db"];
let mcpServers: typeof import("../server/db/schema.ts")["mcpServers"];

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  ({ mcp } = await import("../server/runner/mcp.ts"));
  ({ db } = await import("../server/db/client.ts"));
  ({ mcpServers } = await import("../server/db/schema.ts"));
});

afterEach(async () => {
  await mcp.shutdown();
  await db.delete(mcpServers);
  fs.rmSync(spawnLog, { force: true });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("connects a configured server and offers its tools qualified by slug", async () => {
  await mcp.sync([config()]);

  expect(mcp.state()).toMatchObject([{ slug: "echo", status: "ready", error: "" }]);
  expect(toolNames()).toEqual(["echo__ping", "echo__echo", "echo__add"]);
  expect(await mcp.call("echo__ping", {})).toBe("ping({})");
});

test("an unchanged config is left alone rather than reconnected", async () => {
  await mcp.sync([config()]);
  await mcp.sync([config()]);

  // Restarting a stdio server costs a process spawn and drops whatever state it was holding.
  expect(spawned()).toBe(1);
});

test("overlapping syncs off the table reconnect an edited server once", async () => {
  await db.insert(mcpServers).values(config());
  await mcp.sync();

  await db.update(mcpServers).set({ label: "Echo, renamed" });
  // Two callers arriving together is what a batch of writes through the GraphQL hook looks like.
  // Both read the table, both compared the edited row against the entry the other had not
  // replaced yet, and both reconnected — the second's entry overwriting the first, whose child
  // stayed up with nothing left holding a handle to close it. The pool reported one tidy server
  // throughout.
  await Promise.all([mcp.sync(), mcp.sync()]);

  expect(mcp.state()).toMatchObject([{ label: "Echo, renamed", status: "ready" }]);
  expect(spawned()).toBe(2);

  const pids = spawnedPids();
  await mcp.shutdown();
  expect(await stillAlive(pids)).toEqual([]);
});

test("overlapping syncs settle on the last config and orphan nothing", async () => {
  const first = mcp.sync([config({ slug: "one" })]);
  const second = mcp.sync([config({ slug: "two" })]);
  await Promise.all([first, second]);

  expect(mcp.state().map((entry) => entry.slug)).toEqual(["two"]);
  expect(toolNames()).toContain("two__ping");

  const pids = spawnedPids();
  await mcp.shutdown();
  // Unserialised, the first sync finished connecting after the second had already replaced its
  // entry, so it stored its client on an object the pool no longer held — and `shutdown` had
  // nothing to close the child with.
  expect(await stillAlive(pids)).toEqual([]);
});

test("a disabled server holds its place without a connection", async () => {
  await mcp.sync([config({ enabled: false })]);

  expect(mcp.state()).toMatchObject([{ slug: "echo", status: "disabled", tools: [] }]);
  expect(mcp.tools()).toEqual([]);
  expect(spawned()).toBe(0);
});

test("a server that cannot start is reported rather than thrown", async () => {
  await mcp.sync([config({ command: path.join(dir, "does-not-exist") })]);

  const [entry] = mcp.state();
  expect(entry.status).toBe("error");
  expect(entry.error).not.toBe("");
  expect(mcp.tools()).toEqual([]);
});

test("flush pays off a debounced sync, so a reader sees its own write", async () => {
  mcp.syncSoon();
  // The debounce is what the write hook leans on; without `flush` a read arriving in the same
  // millisecond — `create_mcp_server` then `mcp_status` — answers about the pool as it was.
  expect(mcp.state()).toEqual([]);

  await mcp.flush();
  // Nothing is configured in this test's database, so the reconcile is a real one that finds
  // nothing. What matters is that it happened before `flush` resolved.
  expect(mcp.state()).toEqual([]);
});

test("flush is a no-op when nothing is owed", async () => {
  await mcp.sync([config()]);
  await mcp.flush();

  expect(spawned()).toBe(1);
});

test("a removed server is closed and its tools stop being offered", async () => {
  await mcp.sync([config()]);
  await mcp.sync([]);

  expect(mcp.state()).toEqual([]);
  expect(mcp.tools()).toEqual([]);
  await expect(mcp.call("echo__ping", {})).rejects.toThrow(/no connected MCP server/);
});
