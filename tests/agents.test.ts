import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NO_KEY } from "@cubicecho/agent-core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Agent, McpServerRow, Settings } from "../server/db/schema.ts";

// The profile module reaches the database as soon as it is imported, so point it somewhere
// disposable before anything under server/ loads.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-agents-"));
process.env.TASK_SERVER_DATA_DIR = dir;

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-echo.mjs", import.meta.url));

let db: typeof import("../server/db/client.ts")["db"];
let schema: typeof import("../server/db/schema.ts");
let profile: typeof import("../server/runner/profile.ts");
let mcp: typeof import("../server/runner/mcp.ts")["mcp"];

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  ({ db } = await import("../server/db/client.ts"));
  schema = await import("../server/db/schema.ts");
  profile = await import("../server/runner/profile.ts");
  ({ mcp } = await import("../server/runner/mcp.ts"));
});

afterAll(async () => {
  await mcp.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: "default",
  baseUrl: "http://server:11434/v1",
  apiKey: "server-key",
  model: "server-model",
  systemPrompt: "server prompt",
  maxTokens: 1000,
  temperature: 0.5,
  maxToolIterations: 8,
  toolDiscovery: "eager",
  toolSelectModel: "small",
  runRetentionDays: 30,
  requestTimeoutSeconds: 120,
  maxRetries: 2,
  maxConcurrentRuns: 4,
  ...over,
});

/** A profile as the table hands one over: every column at its inherit sentinel. */
const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "agent-1",
  name: "Profile",
  description: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  systemPrompt: "",
  maxTokens: -1,
  temperature: -1,
  maxToolIterations: -1,
  toolDiscovery: "inherit",
  toolSelectModel: "",
  requestTimeoutSeconds: -1,
  maxRetries: -1,
  mcpServerIds: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

test("no profile, and a profile that overrides nothing, are the settings row", () => {
  const base = settings();
  expect(profile.resolveConfig(base, null)).toEqual(base);
  expect(profile.resolveConfig(base, agent())).toEqual(base);
});

test("a profile overrides only the columns it filled in", () => {
  const config = profile.resolveConfig(
    settings(),
    agent({ model: "gpt-5", maxTokens: 4000, toolDiscovery: "ondemand" }),
  );
  expect(config.model).toBe("gpt-5");
  expect(config.maxTokens).toBe(4000);
  expect(config.toolDiscovery).toBe("ondemand");
  // Untouched columns still answer from settings, including the key.
  expect(config.systemPrompt).toBe("server prompt");
  expect(config.temperature).toBe(0.5);
  expect(config.apiKey).toBe("server-key");
});

test("zero is a value, and -1 is the only way to inherit a number", () => {
  const config = profile.resolveConfig(
    settings(),
    agent({ maxRetries: 0, requestTimeoutSeconds: 0, temperature: 0 }),
  );
  expect(config.maxRetries).toBe(0);
  expect(config.requestTimeoutSeconds).toBe(0);
  expect(config.temperature).toBe(0);
});

test("whitespace is not an override", () => {
  const config = profile.resolveConfig(settings(), agent({ model: "   ", systemPrompt: "\n" }));
  expect(config.model).toBe("server-model");
  expect(config.systemPrompt).toBe("server prompt");
});

test("a profile with an endpoint of its own never inherits the server's key", async () => {
  const borrowed = profile.resolveConfig(settings(), agent({ baseUrl: "http://friend/v1" }));
  expect(borrowed.baseUrl).toBe("http://friend/v1");
  expect(borrowed.apiKey).toBe(NO_KEY);

  const own = profile.resolveConfig(
    settings(),
    agent({ baseUrl: "http://friend/v1", apiKey: "friend-key" }),
  );
  expect(own.apiKey).toBe("friend-key");

  // The same endpoint written out again is the same endpoint, and inherits like anything else.
  const same = profile.resolveConfig(settings(), agent({ baseUrl: "http://server:11434/v1" }));
  expect(same.apiKey).toBe("server-key");
});

/**
 * The whole sentinel matrix, held as rows rather than as a rule restated. Each case names what
 * the profile and the settings row say and the columns that should differ from the settings row;
 * the comparison is of the whole row, so a column that leaks in or goes missing fails too.
 */
const GOLDEN: {
  name: string;
  settings?: Partial<Settings>;
  agent: Partial<Agent>;
  expected: Partial<Settings>;
}[] = [
  {
    name: "every column filled in",
    agent: {
      model: "gpt-5",
      systemPrompt: "profile prompt",
      maxTokens: 4000,
      temperature: 1.5,
      maxToolIterations: 3,
      toolDiscovery: "ondemand",
      toolSelectModel: "tiny",
      requestTimeoutSeconds: 30,
      maxRetries: 5,
    },
    expected: {
      model: "gpt-5",
      systemPrompt: "profile prompt",
      maxTokens: 4000,
      temperature: 1.5,
      maxToolIterations: 3,
      toolDiscovery: "ondemand",
      toolSelectModel: "tiny",
      requestTimeoutSeconds: 30,
      maxRetries: 5,
    },
  },
  {
    name: "every number at zero",
    agent: {
      maxTokens: 0,
      temperature: 0,
      maxToolIterations: 0,
      requestTimeoutSeconds: 0,
      maxRetries: 0,
    },
    expected: {
      maxTokens: 0,
      temperature: 0,
      maxToolIterations: 0,
      requestTimeoutSeconds: 0,
      maxRetries: 0,
    },
  },
  {
    name: "any negative number inherits, not only -1",
    agent: {
      maxTokens: -5,
      temperature: -0.5,
      maxToolIterations: -2,
      requestTimeoutSeconds: -100,
      maxRetries: -3,
    },
    expected: {},
  },
  {
    name: "a zero in settings survives a profile that inherits it",
    settings: { maxTokens: 0, temperature: 0, maxToolIterations: 0, maxRetries: 0 },
    agent: { model: "gpt-5" },
    expected: { model: "gpt-5" },
  },
  {
    name: "whitespace in every string column",
    agent: { baseUrl: "  ", model: " \t", systemPrompt: "\n\n", toolSelectModel: " " },
    expected: {},
  },
  {
    name: "a padded string is trimmed on the way in",
    agent: { model: "  gpt-5 ", systemPrompt: "\n  be brief\n", toolSelectModel: " tiny " },
    expected: { model: "gpt-5", systemPrompt: "be brief", toolSelectModel: "tiny" },
  },
  {
    name: "an empty string in settings stays empty under a profile that inherits it",
    settings: { toolSelectModel: "", systemPrompt: "" },
    agent: { model: "gpt-5" },
    expected: { model: "gpt-5" },
  },
  {
    // The one row that moved when the merge became agent-core's: the resolver joins prompt
    // parts and trims the result, so the server's prompt loses its padding once a profile is in
    // play. With no profile the settings row is returned untouched, padding and all.
    name: "a settings prompt with space around it, under a profile that inherits it",
    settings: { systemPrompt: "  server prompt\n" },
    agent: { model: "gpt-5" },
    expected: { model: "gpt-5", systemPrompt: "server prompt" },
  },
  {
    name: "inherit over ondemand",
    settings: { toolDiscovery: "ondemand" },
    agent: { toolDiscovery: "inherit" },
    expected: {},
  },
  {
    name: "eager over ondemand",
    settings: { toolDiscovery: "ondemand" },
    agent: { toolDiscovery: "eager" },
    expected: { toolDiscovery: "eager" },
  },
  {
    name: "another endpoint and no key",
    agent: { baseUrl: "http://friend/v1" },
    expected: { baseUrl: "http://friend/v1", apiKey: NO_KEY },
  },
  {
    name: "another endpoint, padded, and no key",
    agent: { baseUrl: "  http://friend/v1 " },
    expected: { baseUrl: "http://friend/v1", apiKey: NO_KEY },
  },
  {
    name: "another endpoint with its own key",
    agent: { baseUrl: "http://friend/v1", apiKey: "friend-key" },
    expected: { baseUrl: "http://friend/v1", apiKey: "friend-key" },
  },
  {
    name: "another endpoint when the server has no key either",
    settings: { apiKey: "" },
    agent: { baseUrl: "http://friend/v1" },
    expected: { baseUrl: "http://friend/v1", apiKey: NO_KEY },
  },
  {
    name: "the same endpoint written out again",
    agent: { baseUrl: " http://server:11434/v1 " },
    expected: {},
  },
  {
    name: "the same endpoint with a key of its own",
    agent: { apiKey: "other-key" },
    expected: { apiKey: "other-key" },
  },
  {
    name: "the same endpoint when the server has no key",
    settings: { apiKey: "" },
    agent: { model: "gpt-5" },
    expected: { model: "gpt-5" },
  },
  {
    // Spelled differently is a different endpoint: the comparison is of the strings, and the
    // cost of being wrong in the other direction is a key posted somewhere it was not issued for.
    name: "the same endpoint with a trailing slash",
    agent: { baseUrl: "http://server:11434/v1/" },
    expected: { baseUrl: "http://server:11434/v1/", apiKey: NO_KEY },
  },
  {
    name: "a server scope changes nothing in the row",
    agent: { mcpServerIds: ["a", "b"] },
    expected: {},
  },
];

test.each(GOLDEN)("profile over settings: $name", ({ settings: base, agent: over, expected }) => {
  const row = settings(base);
  expect(profile.resolveConfig(row, agent(over))).toEqual({ ...row, ...expected });
});

test("an empty server list is every server, not none", () => {
  expect(profile.resolveServers(null)).toBeUndefined();
  expect(profile.resolveServers(agent())).toBeUndefined();
  expect(profile.resolveServers(agent({ mcpServerIds: [] }))).toBeUndefined();
  expect(profile.resolveServers(agent({ mcpServerIds: ["a", "b"] }))).toEqual(new Set(["a", "b"]));
});

test("a task reads its own profile, and a task with none reads settings", async () => {
  const [row] = await db
    .insert(schema.agents)
    .values({ name: "Local", baseUrl: "http://localhost:1234/v1", model: "qwen" })
    .returning();
  const [onProfile] = await db
    .insert(schema.tasks)
    .values({ name: "on profile", prompt: "go", agentId: row.id })
    .returning();
  const [plain] = await db.insert(schema.tasks).values({ name: "plain", prompt: "go" }).returning();

  const configured = await profile.configForTask(onProfile);
  expect(configured.config.baseUrl).toBe("http://localhost:1234/v1");
  expect(configured.config.model).toBe("qwen");

  const bare = await profile.configForTask(plain);
  expect(bare.config).toEqual(await (await import("../server/runner/llm.ts")).loadSettings());
  expect(bare.servers).toBeUndefined();

  // Deleting the profile leaves the task, running on the server's own settings again.
  await db.delete(schema.agents);
  const [after] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, onProfile.id));
  expect(after.agentId).toBeNull();
});

test("a run scoped to one server cannot see or call another's tools", async () => {
  const server = (over: Partial<McpServerRow>): McpServerRow => ({
    id: "",
    slug: "",
    label: "",
    enabled: true,
    transport: "stdio",
    command: process.execPath,
    args: [FIXTURE],
    env: null,
    url: "",
    headers: null,
    hiddenTools: null,
    hooks: null,
    ...over,
  });

  await mcp.sync([server({ id: "mine", slug: "mine" }), server({ id: "theirs", slug: "theirs" })]);

  const names = (servers?: ReadonlySet<string>) =>
    mcp
      .tools({ servers })
      .flatMap((tool) => (tool.type === "function" ? [tool.function.name] : []));

  expect(names()).toEqual(expect.arrayContaining(["mine__echo", "theirs__echo"]));
  const scoped = names(new Set(["mine"]));
  expect(scoped).toContain("mine__echo");
  expect(scoped.every((name) => name.startsWith("mine__"))).toBe(true);
  expect(mcp.catalog(new Set(["mine"])).map((entry) => entry.id)).toEqual(["mine"]);

  // A name the model remembers from a wider run is refused, not merely unlisted.
  await expect(mcp.call("theirs__echo", { text: "hi" }, new Set(["mine"]))).rejects.toThrow(
    /no connected MCP server offers a tool/,
  );
  await expect(mcp.call("mine__echo", { text: "hi" }, new Set(["mine"]))).resolves.toContain("hi");

  // Loading a schema by name is the same door, so it is held to the same scope.
  expect(mcp.tools({ names: ["theirs__echo"], servers: new Set(["mine"]) })).toEqual([]);
});
