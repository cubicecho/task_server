import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSpec } from "@cubicecho/agent-core";
import { type GraphQLSchema, graphql } from "graphql";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { specFileName, specText } from "@/lib/agent-spec";

// The schema is built from the live tables at import time, so the database has to be pointed
// somewhere disposable before anything under server/ is loaded.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-agent-spec-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let db: typeof import("../server/db/client.ts")["db"];
let tables: typeof import("../server/db/schema.ts");
let schema: GraphQLSchema;
let cron: typeof import("../server/scheduler/cron.ts");
let mcp: typeof import("../server/runner/mcp.ts")["mcp"];

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  ({ db } = await import("../server/db/client.ts"));
  tables = await import("../server/db/schema.ts");
  schema = (await import("../server/graphql/schema.ts")).schema;
  cron = await import("../server/scheduler/cron.ts");
  ({ mcp } = await import("../server/runner/mcp.ts"));
});

// Every test here is about what one document does to two tables, so each starts with both
// empty rather than with whatever the one before it left.
beforeEach(async () => {
  await db.delete(tables.agents);
  await db.delete(tables.mcpServers);
});

afterAll(async () => {
  await cron.stop();
  await mcp.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Asks the schema as the operator, and hands back the data or the errors' own words. */
async function ask<T>(source: string, variableValues?: Record<string, unknown>) {
  const { data, errors } = await graphql({ schema, source, variableValues });
  return { data: data as T | null | undefined, errors: (errors ?? []).map((e) => e.message) };
}

async function exported(agentId: string) {
  const { data, errors } = await ask<{ agentSpec: Record<string, unknown> }>(
    `query ($agentId: String!) { agentSpec(agentId: $agentId) }`,
    { agentId },
  );
  expect(errors).toEqual([]);
  // What a client receives: the response is JSON, so anything that would not survive being
  // written down has to be gone here too.
  return JSON.parse(JSON.stringify(data?.agentSpec)) as Record<string, unknown>;
}

const SECRETS = ["sk-profile-secret", "env-secret-value", "Bearer header-secret"];

/** Two servers a profile can be narrowed to, each holding a credential where one is kept. */
async function seedServers() {
  await db.insert(tables.mcpServers).values([
    {
      id: "srv-stdio",
      slug: "memory",
      label: "Memory",
      transport: "stdio",
      command: "npx",
      args: ["-y", "memory-server"],
      env: { MEMORY_TOKEN: "env-secret-value" },
      hiddenTools: ["recall"],
      hooks: [{ id: "recall", on: "beforeTurn", tool: "recall", inject: true }],
    },
    {
      id: "srv-http",
      slug: "search",
      transport: "http",
      url: "https://search.example/mcp",
      headers: { Authorization: "Bearer header-secret" },
    },
    { id: "srv-other", slug: "unrelated", transport: "stdio", command: "other" },
  ]);
}

test("an exported profile carries no key, and no env or headers of the servers it bundles", async () => {
  await seedServers();
  await db.insert(tables.agents).values({
    id: "a1",
    name: "Researcher",
    description: "Reads and remembers",
    baseUrl: "http://local:11434/v1",
    apiKey: "sk-profile-secret",
    model: "big",
    mcpServerIds: ["srv-stdio", "srv-http"],
  });

  const spec = await exported("a1");
  const text = JSON.stringify(spec);

  for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
  // Not only the values: the names of what was held are the library's to strip too, and a
  // document with an `env` of blanks would read as one that had been filled in.
  for (const field of ["apiKey", "env", "headers", "MEMORY_TOKEN", "Authorization"]) {
    expect(text, field).not.toContain(field);
  }

  // And it is still a spec, with the servers still described well enough to start.
  expect(parseSpec(spec, { bundle: true }).errors).toEqual([]);
  expect(spec.tools).toEqual({ servers: ["memory", "search"] });
  expect(spec.bundle).toEqual({
    mcpServers: [
      {
        slug: "memory",
        label: "Memory",
        transport: "stdio",
        command: "npx",
        args: ["-y", "memory-server"],
        hiddenTools: ["recall"],
        hooks: [{ id: "recall", on: "beforeTurn", tool: "recall", inject: true }],
      },
      { slug: "search", transport: "http", url: "https://search.example/mcp" },
    ],
  });
});

test("a column left to inherit is a field the document does not have", async () => {
  await db.insert(tables.agents).values({ id: "bare", name: "Bare" });
  expect(await exported("bare")).toEqual({ spec: "cubicecho.agent/1", name: "Bare" });

  await db.insert(tables.agents).values({
    id: "full",
    name: "Full",
    description: "Everything said",
    baseUrl: "http://local:11434/v1",
    model: "big",
    systemPrompt: "Be brief.",
    maxTokens: 0,
    temperature: 0,
    maxToolIterations: 12,
    toolDiscovery: "ondemand",
    toolSelectModel: "small",
    requestTimeoutSeconds: 0,
    maxRetries: 0,
  });
  // Zero is an answer for every one of these, and has to arrive as zero rather than as nothing.
  expect(await exported("full")).toEqual({
    spec: "cubicecho.agent/1",
    name: "Full",
    description: "Everything said",
    endpoint: { baseUrl: "http://local:11434/v1", requestTimeoutSeconds: 0 },
    model: { model: "big", maxTokens: 0, temperature: 0 },
    prompt: [{ id: "system", text: "Be brief." }],
    tools: { discovery: "ondemand", maxIterations: 12 },
    retry: { maxRetries: 0 },
    tasks: { toolSelect: { model: "small" } },
  });
});

// Empty and absent are both "every server" in the column, and both are a document that says
// nothing about servers. A scope whose rows are all gone is the other thing: no run on that
// profile reaches a tool today, and an export that left the list out would hand its importer
// every server they have.
test("the scope is exported as it runs, not as it reads", async () => {
  await seedServers();
  await db.insert(tables.agents).values([
    { id: "null", name: "Null", mcpServerIds: null },
    { id: "empty", name: "Empty", mcpServerIds: [] },
    { id: "stale", name: "Stale", mcpServerIds: ["deleted-row"] },
    { id: "half", name: "Half", mcpServerIds: ["deleted-row", "srv-http"] },
  ]);

  expect((await exported("null")).tools).toBeUndefined();
  expect((await exported("empty")).tools).toBeUndefined();
  expect((await exported("empty")).bundle).toBeUndefined();

  const stale = await exported("stale");
  expect(stale.tools).toEqual({ servers: [] });
  expect(stale.bundle).toBeUndefined();

  expect((await exported("half")).tools).toEqual({ servers: ["search"] });
});

test("exporting a profile that is not there says so", async () => {
  const { errors } = await ask(`{ agentSpec(agentId: "nobody") }`);
  expect(errors).toEqual(["There is no agent with id nobody."]);
});

// A name is whatever somebody typed; a file name is not.
test("the file is named after the profile, whatever the profile is named", () => {
  expect(specFileName("Researcher")).toBe("Researcher.agent.json");
  expect(specFileName("  nightly / summary  ")).toBe("nightly-summary.agent.json");
  expect(specFileName("../../etc/passwd")).toBe("etc-passwd.agent.json");
  expect(specFileName("über agent v1.2")).toBe("über-agent-v1.2.agent.json");
  expect(specFileName("///")).toBe("agent.agent.json");
  expect(specText({ spec: "cubicecho.agent/1" })).toBe('{\n  "spec": "cubicecho.agent/1"\n}\n');
});
