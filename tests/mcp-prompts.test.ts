import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import type { McpServerRow } from "../server/db/schema.ts";

// Loading the pool pulls in the database module, so give it somewhere disposable first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-mcp-prompts-"));
process.env.TASK_SERVER_DATA_DIR = dir;

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-echo.mjs", import.meta.url));

/**
 * What a server offers a picker, read off a real connection.
 *
 * A prompt is the one part of the protocol this server reaches for outside the pool's tool path
 * — `prompts/list` and `prompts/get` on the client itself — so the thing worth pinning is that
 * the round trip works and that what comes back is the single string a prompt box takes,
 * whatever shape the server answered in. No mocks for the same reason the pool tests use none:
 * the SDK checks a server's declared capabilities before it sends either request, and a stub of
 * the client would be a stub of the very check being relied on.
 */
const config = (over: Partial<McpServerRow> = {}): McpServerRow => ({
  id: "echo-1",
  slug: "echo",
  label: "Echo",
  enabled: true,
  transport: "stdio",
  command: process.execPath,
  args: [FIXTURE],
  env: { MCP_ECHO_PROMPTS: "1" },
  url: "",
  headers: null,
  ...over,
});

let mcp: typeof import("../server/runner/mcp.ts")["mcp"];
let prompts: typeof import("../server/runner/mcp-prompts.ts");
let db: typeof import("../server/db/client.ts")["db"];
let mcpServers: typeof import("../server/db/schema.ts")["mcpServers"];

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  ({ mcp } = await import("../server/runner/mcp.ts"));
  prompts = await import("../server/runner/mcp-prompts.ts");
  ({ db } = await import("../server/db/client.ts"));
  ({ mcpServers } = await import("../server/db/schema.ts"));
});

afterEach(async () => {
  await mcp.shutdown();
  await db.delete(mcpServers);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("lists what a connected server offers, carrying the server on every row", async () => {
  await mcp.sync([config()]);

  const listed = await prompts.list();
  expect(listed.map((prompt) => prompt.name)).toEqual(["greet", "worked-example", "attached"]);
  // Two servers may name a prompt the same, so a row is only addressable with both halves.
  expect(listed[0]).toMatchObject({
    server: "echo-1",
    serverLabel: "Echo",
    title: "Greet somebody",
  });
  // Omitting `required` is how the protocol says "optional"; a picker reads it as a boolean.
  expect(listed[0].arguments).toEqual([
    { name: "who", description: "The name to greet", required: true },
    { name: "mood", description: "How warmly", required: false },
  ]);
});

test("a server that declares no prompts is never asked, and offers none", async () => {
  await mcp.sync([config({ env: {} })]);

  expect(mcp.state()).toMatchObject([{ status: "ready" }]);
  // The capability is the filter rather than a `try` around the call: the SDK refuses to send
  // `prompts/list` to a server that never claimed it, so asking anyway is an error per server
  // per listing — and one that would be indistinguishable from a server that is actually broken.
  expect(await prompts.list()).toEqual([]);
});

test("a disabled server is not in the picker", async () => {
  await mcp.sync([config({ enabled: false })]);

  expect(await prompts.list()).toEqual([]);
});

test("expands a template with the arguments given, verbatim when it is one message", async () => {
  await mcp.sync([config()]);

  expect(await prompts.get("echo-1", "greet", { who: "Ada" })).toBe("Say hello to Ada.");
});

test("labels the roles when a template answers with more than one message", async () => {
  await mcp.sync([config()]);

  // Lossy and deliberately so: a prompt is one string, and a worked example quoted inside it is
  // still readable as one where a dropped role would not be.
  expect(await prompts.get("echo-1", "worked-example", {})).toBe(
    "assistant: Here is how I would answer.\n\nuser: Now do it for mine.",
  );
});

test("names content that has no text rather than dropping it", async () => {
  await mcp.sync([config()]);

  const expansion = await prompts.get("echo-1", "attached", {});
  // An embedded resource carries its text and unwraps to it; an image cannot, and leaving a gap
  // where it was would read as a template that simply said less.
  expect(expansion).toContain("user: A");
  expect(expansion).toContain("[image content]");
});

test("refuses a server that offers no prompts before dialling it", async () => {
  await mcp.sync([config()]);

  await expect(prompts.get("nowhere", "greet", {})).rejects.toThrow(/not a connected MCP server/);
});
