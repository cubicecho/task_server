import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSpec } from "@cubicecho/agent-core";
import { type GraphQLSchema, graphql } from "graphql";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  initialTicks,
  mayImport,
  overrides,
  type ProfileColumns,
  readSpec,
  specFileName,
  specText,
  tickedSlugs,
} from "@/lib/agent-spec";
import type { Agent, McpServerRow } from "../server/db/schema.ts";

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

// Every command in this file is one no machine has. An import that creates a server tells the
// pool, the pool dials what the table holds, and a test about a document should not find out
// what `npx` would have fetched.
const SECRETS = ["sk-profile-secret", "env-secret-value", "Bearer header-secret"];

/** Two servers a profile can be narrowed to, each holding a credential where one is kept. */
async function seedServers() {
  await db.insert(tables.mcpServers).values([
    {
      id: "srv-stdio",
      slug: "memory",
      label: "Memory",
      transport: "stdio",
      command: "no-such-mcp-server",
      args: ["--stdio"],
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
    { id: "srv-other", slug: "unrelated", transport: "stdio", command: "no-such-other-server" },
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
        command: "no-such-mcp-server",
        args: ["--stdio"],
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

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

interface Preview {
  refusals: string[];
  warnings: string[];
  dropped: string[];
  agent: Record<string, unknown> | null;
  servers: { slug: string; label: string; created: boolean }[] | null;
  bundled: {
    slug: string;
    transport: string;
    target: string;
    envNames: string[];
    headerNames: string[];
    exists: boolean;
    create: boolean;
    createByDefault: boolean;
    problems: string[];
    notes: string[];
  }[];
}

const PREVIEW = `query ($document: JSON!, $createServers: [String!], $name: String) {
  agentSpecPreview(document: $document, createServers: $createServers, name: $name) {
    refusals warnings dropped
    agent {
      name description baseUrl model systemPrompt maxTokens temperature maxToolIterations
      toolDiscovery toolSelectModel requestTimeoutSeconds maxRetries
    }
    servers { slug label created }
    bundled {
      slug transport target envNames headerNames exists create createByDefault problems notes
    }
  }
}`;

const IMPORT = `mutation ($document: JSON!, $createServers: [String!], $name: String) {
  importAgentSpec(document: $document, createServers: $createServers, name: $name) { id name }
}`;

interface Options {
  createServers?: string[];
  name?: string;
}

async function preview(document: unknown, options: Options = {}) {
  const { data, errors } = await ask<{ agentSpecPreview: Preview }>(PREVIEW, {
    document,
    ...options,
  });
  expect(errors).toEqual([]);
  return (data as { agentSpecPreview: Preview }).agentSpecPreview;
}

/** The write. Answers with the new row's id, or with why there is none. */
async function importSpec(document: unknown, options: Options = {}) {
  const { data, errors } = await ask<{ importAgentSpec: { id: string } }>(IMPORT, {
    document,
    ...options,
  });
  return { id: data?.importAgentSpec.id, errors };
}

/** Both tables, which is everything an import may touch. */
async function written() {
  return {
    agents: await db.select().from(tables.agents),
    servers: await db.select().from(tables.mcpServers),
  };
}

/** The columns an import fills in — a row with what makes it this row taken off. */
const columns = (row: Agent) => {
  const { id: _id, name: _name, createdAt: _created, updatedAt: _updated, ...rest } = row;
  return rest;
};

const SPEC = "cubicecho.agent/1";

/** A bundle as another host would write one: a command to run, and a url to dial. */
const BUNDLE = {
  mcpServers: [
    {
      slug: "memory",
      label: "Memory",
      transport: "stdio",
      command: "no-such-mcp-server",
      args: ["--stdio"],
    },
    { slug: "search", transport: "http", url: "https://search.example/mcp" },
  ],
};

test("a profile exported and imported back has the same columns, and nothing was dropped", async () => {
  await seedServers();
  await db.insert(tables.agents).values({
    id: "a1",
    name: "Researcher",
    description: "Reads and remembers",
    baseUrl: "http://local:11434/v1",
    apiKey: "sk-profile-secret",
    model: "big",
    systemPrompt: "Be brief.\n\nCite what you read.",
    maxTokens: 2048,
    temperature: 0.5,
    maxToolIterations: 12,
    toolDiscovery: "ondemand",
    toolSelectModel: "small",
    requestTimeoutSeconds: 90,
    maxRetries: 3,
    mcpServerIds: ["srv-stdio", "srv-http"],
  });
  const spec = await exported("a1");

  // The servers are here already and none is asked for, so the slugs mean the rows that exist.
  const shown = await preview(spec, { name: "Researcher (copy)" });
  expect(shown.refusals).toEqual([]);
  expect(shown.dropped).toEqual([]);
  expect(shown.servers).toEqual([
    { slug: "memory", label: "Memory", created: false },
    { slug: "search", label: "", created: false },
  ]);

  const { id, errors } = await importSpec(spec, { name: "Researcher (copy)" });
  expect(errors).toEqual([]);

  const { agents, servers } = await written();
  const original = agents.find((row) => row.id === "a1") as Agent;
  const copy = agents.find((row) => row.id === id) as Agent;
  expect(copy.name).toBe("Researcher (copy)");
  // Everything but the key, which a document has no way to carry.
  expect(columns(copy)).toEqual({ ...columns(original), apiKey: "" });
  expect(servers).toHaveLength(3);

  // And the copy writes the document it was read from.
  expect(await exported(copy.id)).toEqual({ ...spec, name: "Researcher (copy)" });
});

// Blank is inherit, and the sentinel differs by column because zero is a real answer for most
// of them. A document has one spelling of inherit — the field is not there — so each column is
// taken there and back alone: set, it survives; left, it comes back as its sentinel.
test("every inherit sentinel survives the trip, and so does every zero", async () => {
  const sentinels = {
    description: "",
    baseUrl: "",
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
  } as const;
  const set = {
    description: "said",
    baseUrl: "http://local/v1",
    model: "big",
    systemPrompt: "Be brief.",
    maxTokens: 0,
    temperature: 0,
    maxToolIterations: 1,
    toolDiscovery: "eager",
    toolSelectModel: "small",
    requestTimeoutSeconds: 0,
    maxRetries: 0,
  } as const;

  const trip = async (values: Partial<Agent>) => {
    const [row] = await db
      .insert(tables.agents)
      .values({ name: "Trip", ...values })
      .returning();
    const spec = await exported(row.id);
    const shown = await preview(spec);
    expect(shown.dropped, JSON.stringify(values)).toEqual([]);
    const { id, errors } = await importSpec(spec);
    expect(errors, JSON.stringify(values)).toEqual([]);
    const [back] = (await written()).agents.filter((each) => each.id === id);
    return { spec, back };
  };

  // Nothing set: the document is a name, and every column comes back as its sentinel.
  const bare = await trip({});
  expect(bare.spec).toEqual({ spec: SPEC, name: "Trip" });
  expect(columns(bare.back)).toEqual({ ...sentinels, apiKey: "" });

  for (const [column, value] of Object.entries(set)) {
    const { back } = await trip({ [column]: value });
    expect(columns(back), column).toEqual({ ...sentinels, apiKey: "", [column]: value });
  }

  // `toolDiscovery` has two answers that are not inherit.
  const ondemand = await trip({ toolDiscovery: "ondemand" });
  expect(ondemand.back.toolDiscovery).toBe("ondemand");
});

// The one value a column holds that the format does not: the parser wants at least one tool
// step, so a zero is dropped on the way in and the column goes back to inheriting. Pinned so
// that it is a known edge of the format rather than a surprise.
test("a zero tool-step ceiling is the one value that does not make the trip", async () => {
  await db.insert(tables.agents).values({ id: "zero", name: "Zero", maxToolIterations: 0 });
  const spec = await exported("zero");
  expect(spec.tools).toEqual({ maxIterations: 0 });

  const shown = await preview(spec);
  expect(shown.warnings).toEqual(["tools.maxIterations: must be at least 1, and was dropped"]);
  expect(shown.agent?.maxToolIterations).toBe(-1);
});

test("a slug this server does not have is dropped from the scope, with a warning", async () => {
  await seedServers();
  const document = { spec: SPEC, name: "Narrow", tools: { servers: ["search", "ghost"] } };

  const shown = await preview(document);
  expect(shown.refusals).toEqual([]);
  expect(shown.servers).toEqual([{ slug: "search", label: "", created: false }]);
  expect(shown.warnings).toEqual([
    'tools.servers: "ghost" is not an MCP server here, and was dropped from the profile\'s servers',
  ]);
  expect(shown.dropped).toEqual(['tools.servers: "ghost" is not an MCP server here']);

  const { id, errors } = await importSpec(document);
  expect(errors).toEqual([]);
  const [row] = (await written()).agents.filter((each) => each.id === id);
  // Narrower than the document asked for, and never wider.
  expect(row.mcpServerIds).toEqual(["srv-http"]);
});

// The column cannot say "no servers": empty and null both mean every one. So a document that
// asked for less than everything and resolves to nothing is not saved as everything.
test("a scope that would come out empty refuses the import, and writes nothing", async () => {
  await seedServers();
  const before = await written();

  for (const [servers, reason] of [
    [["ghost", "phantom"], "none of the servers this agent is narrowed to exist here"],
    [[], "gives this agent no servers at all"],
    // The parser drops a field of the wrong kind, which here would be the same widening.
    ["search", "is not a list of slugs"],
    // Every entry dropped by the parser leaves the same empty list.
    [[7, ""], "gives this agent no servers at all"],
  ] as const) {
    const document = { spec: SPEC, name: "Empty", tools: { servers }, bundle: BUNDLE };

    const shown = await preview(document);
    expect(shown.refusals, JSON.stringify(servers)).toHaveLength(1);
    expect(shown.refusals[0], JSON.stringify(servers)).toContain(reason);
    expect(shown.servers).toBeNull();

    const { id, errors } = await importSpec(document);
    expect(id).toBeUndefined();
    expect(errors[0]).toContain("This agent spec cannot be imported");
    expect(errors[0]).toContain(reason);
  }

  expect(await written()).toEqual(before);
});

test("a bundled server is not created unless it is named", async () => {
  // No scope, so there is nothing to resolve: the document imports, and the bundle sits unread.
  const unscoped = { spec: SPEC, name: "Unscoped", bundle: BUNDLE };
  expect((await importSpec(unscoped)).errors).toEqual([]);
  expect((await written()).servers).toEqual([]);

  // Scoped to its bundle and nothing named: neither server is here, so the scope is empty and
  // the import is refused rather than quietly creating what it needs.
  const scoped = { ...unscoped, name: "Scoped", tools: { servers: ["memory", "search"] } };
  const shown = await preview(scoped);
  expect(shown.refusals).toHaveLength(1);
  expect(shown.warnings).toEqual([
    'tools.servers: "memory" is not an MCP server here, and was dropped from the profile\'s ' +
      "servers — the document bundles it, and it can be created",
    'tools.servers: "search" is not an MCP server here, and was dropped from the profile\'s ' +
      "servers — the document bundles it, and it can be created",
  ]);
  expect((await importSpec(scoped)).errors).toHaveLength(1);
  expect((await written()).servers).toEqual([]);

  // One named: that one is created, enabled, and the other is dropped from the scope.
  const one = await importSpec(scoped, { createServers: ["search"] });
  expect(one.errors).toEqual([]);
  const after = await written();
  expect(after.servers.map((row) => [row.slug, row.transport, row.url, row.enabled])).toEqual([
    ["search", "http", "https://search.example/mcp", true],
  ]);
  const [row] = after.agents.filter((each) => each.id === one.id);
  expect(row.mcpServerIds).toEqual([after.servers[0].id]);
});

test("naming both bundled servers creates both, and scopes the profile to them", async () => {
  const document = {
    spec: SPEC,
    name: "Both",
    tools: { servers: ["memory", "search"] },
    bundle: BUNDLE,
  };
  const shown = await preview(document, { createServers: ["memory", "search"] });
  expect(shown.refusals).toEqual([]);
  expect(shown.servers).toEqual([
    { slug: "memory", label: "Memory", created: true },
    { slug: "search", label: "", created: true },
  ]);
  // A preview is a read.
  expect((await written()).servers).toEqual([]);

  const { id, errors } = await importSpec(document, { createServers: ["memory", "search"] });
  expect(errors).toEqual([]);

  const { agents, servers } = await written();
  const memory = servers.find((row) => row.slug === "memory") as McpServerRow;
  expect(memory).toMatchObject({
    label: "Memory",
    transport: "stdio",
    command: "no-such-mcp-server",
    args: ["--stdio"],
    env: null,
    enabled: true,
  });
  const [row] = agents.filter((each) => each.id === id);
  expect(new Set(row.mcpServerIds)).toEqual(new Set(servers.map((server) => server.id)));
});

test("the preview offers an http server ticked and a stdio one not", async () => {
  const document = { spec: SPEC, name: "Ticks", bundle: BUNDLE };

  const fresh = await preview(document);
  expect(fresh.bundled.map((s) => [s.slug, s.transport, s.target, s.createByDefault])).toEqual([
    // A command line out of a file is run only when somebody chose to.
    ["memory", "stdio", "no-such-mcp-server --stdio", false],
    ["search", "http", "https://search.example/mcp", true],
  ]);
  expect(fresh.bundled.every((server) => !server.create && !server.exists)).toBe(true);

  // One that is here already is not offered at all: ticked, it would refuse the import.
  await seedServers();
  const here = await preview(document);
  expect(here.bundled.map((s) => [s.slug, s.exists, s.createByDefault])).toEqual([
    ["memory", true, false],
    ["search", true, false],
  ]);
});

test("a preview names what a bundled server would be given, and never the values", async () => {
  const document = {
    spec: SPEC,
    name: "Secrets",
    bundle: {
      mcpServers: [
        {
          slug: "m",
          transport: "stdio",
          command: "no-such-mcp-server",
          env: { TOKEN: "env-secret-value" },
        },
        {
          slug: "s",
          transport: "http",
          url: "https://s.example/mcp",
          headers: { Authorization: "Bearer header-secret" },
        },
      ],
    },
  };
  const shown = await preview(document);
  expect(shown.bundled.map((s) => [s.envNames, s.headerNames])).toEqual([
    [["TOKEN"], []],
    [[], ["Authorization"]],
  ]);
  for (const secret of SECRETS) expect(JSON.stringify(shown)).not.toContain(secret);
});

test("creating a bundled server whose slug is taken refuses the import, and writes nothing", async () => {
  await seedServers();
  const before = await written();
  const document = {
    spec: SPEC,
    name: "Clash",
    tools: { servers: ["search", "fresh"] },
    bundle: {
      mcpServers: [
        { slug: "search", transport: "http", url: "https://other.example/mcp" },
        { slug: "fresh", transport: "http", url: "https://fresh.example/mcp" },
      ],
    },
  };

  const shown = await preview(document, { createServers: ["search", "fresh"] });
  expect(shown.refusals).toEqual([
    'bundle: "search" is already an MCP server here, and an import does not overwrite one. ' +
      "Leave it unticked to use the one that exists.",
  ]);

  // `fresh` was fine on its own, and is not created either: the import is one thing.
  const { id, errors } = await importSpec(document, { createServers: ["search", "fresh"] });
  expect(id).toBeUndefined();
  expect(errors[0]).toContain('"search" is already an MCP server here');
  expect(await written()).toEqual(before);

  // Left unnamed, the same slug is the row that exists — a resolution, not a collision.
  const resolved = await importSpec(document, { createServers: ["fresh"] });
  expect(resolved.errors).toEqual([]);
  const after = await written();
  expect(after.servers.find((row) => row.slug === "search")?.url).toBe(
    "https://search.example/mcp",
  );
  const [row] = after.agents.filter((each) => each.id === resolved.id);
  expect(row.mcpServerIds).toEqual([
    "srv-http",
    after.servers.find((server) => server.slug === "fresh")?.id,
  ]);
});

// A created row goes through the checks every other MCP server write does.
test("a bundled server the form would refuse is refused from a file too", async () => {
  const document = {
    spec: SPEC,
    name: "Broken",
    bundle: {
      mcpServers: [
        { slug: "nocommand", transport: "stdio" },
        { slug: "not a slug", transport: "http", url: "ftp://files.example" },
        {
          slug: "badhook",
          transport: "stdio",
          command: "no-such-mcp-server",
          hooks: [{ id: "h", on: "never" }],
        },
      ],
    },
  };

  const shown = await preview(document);
  expect(shown.refusals).toEqual([]);
  expect(shown.bundled[0].problems).toEqual(["needs a command"]);
  expect(shown.bundled[1].problems).toHaveLength(2);
  expect(shown.bundled[2].problems.length).toBeGreaterThan(0);
  // Not offered ticked, since ticking it is what refuses.
  expect(shown.bundled.map((server) => server.createByDefault)).toEqual([false, false, false]);

  for (const slug of ["nocommand", "not a slug", "badhook"]) {
    const { errors } = await importSpec(document, { createServers: [slug] });
    expect(errors[0], slug).toContain(`"${slug}" cannot be saved as written`);
  }
  // And a name that is not in the bundle is not a server to create from anywhere else.
  const stranger = await importSpec(document, { createServers: ["elsewhere"] });
  expect(stranger.errors[0]).toContain('"elsewhere" is not a server this document bundles');

  expect(await written()).toEqual({ agents: [], servers: [] });
});

// The document was written for a host that compacts. Here the hook waits forever, which is
// worth saying and not worth refusing an agent over — unlike the same hook typed into the form.
test("a hook this host never fires is a note on import, and still a refusal on a write", async () => {
  const hooks = [{ id: "c", on: "beforeCompact", tool: "echo" }];
  const document = {
    spec: SPEC,
    name: "Compacts",
    hooks: [{ id: "agent-level", on: "beforeCompact", server: "m", tool: "echo" }],
    bundle: {
      mcpServers: [{ slug: "m", transport: "stdio", command: "no-such-mcp-server", hooks }],
    },
  };

  const shown = await preview(document, { createServers: ["m"] });
  expect(shown.refusals).toEqual([]);
  expect(shown.bundled[0].problems).toEqual([]);
  expect(shown.bundled[0].notes).toEqual([
    'hook "c": task-server never compacts, so beforeCompact never fires — kept as written, ' +
      "and never called",
  ]);
  // The parser says the same of the agent's own hook, and a profile has nowhere to put one.
  expect(shown.warnings).toContain('hooks[0].on: "beforeCompact" is never fired by this host');
  expect(shown.dropped).toEqual([
    'hooks[0]: "agent-level" — a profile has no hooks here; a hook is set on its MCP server\'s row',
  ]);

  expect((await importSpec(document, { createServers: ["m"] })).errors).toEqual([]);
  expect((await written()).servers[0].hooks).toEqual(hooks);

  const { errors } = await ask(
    `mutation ($hooks: JSON) {
      createMcpServer(values: { slug: "typed", command: "no-such-mcp-server", hooks: $hooks }) { id }
    }`,
    { hooks },
  );
  expect(errors[0]).toContain("never compacts");
});

test("a document that is not a spec is refused in the parser's words", async () => {
  for (const [document, reason] of [
    ["not an object", "spec: must be an object"],
    [{ name: "No token" }, 'spec: must be "cubicecho.agent/1"'],
    [
      { spec: "cubicecho.agent/2", name: "Later" },
      "spec: is version 2, and this build reads version 1",
    ],
    [{ spec: SPEC, name: "Shape", prompt: "Be brief." }, "prompt: must be an array"],
    [
      { spec: SPEC, name: "Needs", requires: ["sandbox"] },
      'requires[0]: "sandbox" is not understood by this host',
    ],
  ] as const) {
    const shown = await preview(document);
    expect(shown.refusals, reason).toEqual([reason]);
    expect(shown.agent).toBeNull();

    const { id, errors } = await importSpec(document);
    expect(id).toBeUndefined();
    expect(errors, reason).toEqual([`This agent spec cannot be imported: ${reason}`]);
  }
  expect((await written()).agents).toEqual([]);
});

test("what a profile has no column for is listed, not lost quietly", async () => {
  const document = {
    spec: SPEC,
    $schema: "https://example/agent.schema.json",
    id: "researcher",
    name: "Wide",
    endpoint: { baseUrl: "http://local/v1", firstTokenSeconds: 30 },
    model: { model: "big", maxTokens: 1.5, reasoningEffort: "high", contextLength: 8192 },
    prompt: [
      { id: "persona", text: "You are careful." },
      { id: "rules", text: "Cite." },
      { id: "file", ref: { type: "file", value: "./prompt.md" } },
    ],
    tools: { discovery: "proxy" },
    retry: { loadingTimeoutSeconds: 60 },
    tasks: { title: { model: "tiny" }, toolSelect: { model: "small", maxTokens: 10 } },
    extensions: { "x-sandbox": { image: "alpine" } },
    futureKey: true,
  };

  const shown = await preview(document);
  expect(shown.refusals).toEqual([]);
  expect(shown.dropped.map((line) => line.split(":")[0])).toEqual([
    "id",
    "$schema",
    "futureKey",
    "extensions.x-sandbox",
    "endpoint.firstTokenSeconds",
    "model.reasoningEffort",
    "model.contextLength",
    "retry.loadingTimeoutSeconds",
    "tools.discovery",
    "tasks.title",
    "tasks.toolSelect.maxTokens",
    "prompt[0].id",
    "prompt[1].id",
    "prompt[2].ref",
    "model.maxTokens",
  ]);
  expect(shown.agent).toMatchObject({
    name: "Wide",
    model: "big",
    systemPrompt: "You are careful.\n\nCite.",
    maxTokens: -1,
    toolDiscovery: "inherit",
    toolSelectModel: "small",
  });
  expect(shown.warnings).toContain(
    "prompt: 2 parts are joined into the one system prompt a profile holds",
  );
});

test("an imported profile has no key, and the preview says what that means", async () => {
  const elsewhere = { spec: SPEC, name: "Elsewhere", endpoint: { baseUrl: "http://local/v1" } };
  expect((await preview(elsewhere)).warnings).toEqual([
    "endpoint.baseUrl: the profile names an endpoint of its own and a spec carries no key, " +
      "so it sends none until one is set on the profile",
  ]);
  // On the server's own endpoint it inherits the key like anything else, and nothing is said.
  expect((await preview({ spec: SPEC, name: "Here" })).warnings).toEqual([]);

  // A document that tries to carry one loses it at the parser.
  const keyed = { ...elsewhere, endpoint: { ...elsewhere.endpoint, apiKey: "sk-profile-secret" } };
  const { id, errors } = await importSpec(keyed);
  expect(errors).toEqual([]);
  const [row] = (await written()).agents.filter((each) => each.id === id);
  expect(row.apiKey).toBe("");
  expect(row.baseUrl).toBe("http://local/v1");
});

test("a document with no name needs one given, and a given one wins", async () => {
  expect((await preview({ spec: SPEC })).refusals).toEqual([
    "name: the document names no agent, so give the profile a name",
  ]);
  expect((await preview({ spec: SPEC }, { name: "Given" })).agent?.name).toBe("Given");
  expect((await preview({ spec: SPEC, name: "Own" }, { name: "Given" })).agent?.name).toBe("Given");
  expect((await preview({ spec: SPEC, name: "Own" }, { name: "  " })).agent?.name).toBe("Own");
});

// The browser's half of an import. What the dialog shows is the server's answer; these are the
// three decisions it makes on its own, and a wrong one is a server created that nobody ticked.
test("pasted text is read as far as JSON, and the rest is left to the server", () => {
  expect(readSpec("   ").problem).toMatch(/Paste an agent spec/);
  expect(readSpec("{ not json").problem).toMatch(/^This is not JSON: /);
  expect(readSpec("null").problem).toMatch(/null/);
  // Not a spec, and still a document: saying why is the parser's job, in the preview.
  expect(readSpec("[1, 2]")).toEqual({ document: [1, 2] });
  expect(readSpec('{ "spec": "cubicecho.agent/1" }')).toEqual({
    document: { spec: "cubicecho.agent/1" },
  });
});

test("the form's ticks start where the server says and go back as slugs", async () => {
  const plan = await preview({
    spec: "cubicecho.agent/1",
    name: "ticks",
    bundle: {
      mcpServers: [
        { slug: "local.tool", transport: "stdio", command: "no-such-mcp-server" },
        { slug: "remote", transport: "http", url: "https://mcp.example.test/mcp" },
      ],
    },
  });

  const ticks = initialTicks(plan.bundled);
  // The remote one is offered ticked and the command line is not.
  expect(ticks).toEqual([false, true]);
  expect(tickedSlugs(plan.bundled, ticks)).toEqual(["remote"]);
  // A slug with a dot in it is still one server: the ticks are held by position, not by path.
  expect(tickedSlugs(plan.bundled, [true, false])).toEqual(["local.tool"]);
  // A box the form has not got a value for yet is not a tick.
  expect(tickedSlugs(plan.bundled, [])).toEqual([]);
});

test("import is held until the preview on screen answers what is in the form", () => {
  expect(mayImport(undefined, true)).toBe(false);
  expect(mayImport({ refusals: [] }, false)).toBe(false);
  expect(mayImport({ refusals: ["name: the document names no agent"] }, true)).toBe(false);
  expect(mayImport({ refusals: [] }, true)).toBe(true);
});

test("a previewed profile is summarised by the sentinels the list page reads", async () => {
  const plan = await preview({
    spec: "cubicecho.agent/1",
    name: "summary",
    model: { model: "qwen3" },
    tools: { maxIterations: 4 },
  });
  expect(overrides(plan.agent as unknown as ProfileColumns)).toEqual(["qwen3", "4 tool steps"]);
});
