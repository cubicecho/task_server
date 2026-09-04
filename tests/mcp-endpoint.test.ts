import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { McpHttpHandler } from "@cubicecho/graphql-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import type { GraphQLInputObjectType } from "graphql";
import { afterAll, beforeAll, expect, test } from "vitest";

// The endpoint serves the real schema, which is built against the live tables.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-mcp-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let events: typeof import("../server/runner/events.ts");
let server: Server;
let endpoint: URL;
let client: Client;
let probe: Client;
let probeHandler: McpHttpHandler;
let COLUMN_DOCS: typeof import("../server/graphql/docs.ts").COLUMN_DOCS;

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  events = await import("../server/runner/events.ts");
  const { mountMcp } = await import("../server/mcp-endpoint.ts");
  COLUMN_DOCS = (await import("../server/graphql/docs.ts")).COLUMN_DOCS;

  // The same mount the server uses, so what a client meets here is what it meets in production.
  const app = express();
  mountMcp(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  endpoint = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);

  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(endpoint));

  // The same door, opened one field wider. Every tool the real surface offers is one an agent
  // may reach, so nothing on it can show that the context `/mcp` builds arrives at the rules at
  // all — and if it stopped arriving, every call here would run as the operator and no test in
  // this file would notice. `Query.settings` is a field the map denies an agent, so a handler
  // wired the way `mcp-endpoint.ts` wires its own makes that visible.
  const { createHttpHandler } = await import("@cubicecho/graphql-mcp");
  const { schema } = await import("../server/graphql/schema.ts");
  probeHandler = createHttpHandler({
    schema,
    name: "probe",
    version: "0.0.0",
    include: ["Query.settings"],
    contextFromRequest: () => ({ caller: "agent" }),
  });
  app.all("/mcp-probe", express.json(), probeHandler);

  probe = new Client({ name: "probe-client", version: "0.0.0" });
  await probe.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.href.replace("/mcp", "/mcp-probe"))),
  );
});

afterAll(async () => {
  await probe.close();
  await probeHandler.close();
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
  allOf?: SchemaNode[];
  properties?: Record<string, SchemaNode>;
  definitions?: Record<string, SchemaNode>;
  $defs?: Record<string, SchemaNode>;
}

/**
 * The property names of a `where` argument, whichever shape the driver rendered it in.
 *
 * zod decides where a shared object lands and the two majors disagree: v3 writes it inline, v4
 * hoists it into `definitions` and leaves a `$ref`. An optional `$ref` is then wrapped again —
 * `anyOf: [it, null]` where a null branch is advertised, `allOf: [it]` where it is not, which is
 * what a read's arguments look like under `nullBranches: "never"`. All of them are correct JSON
 * Schema and none is this repo's choice, so the test follows a pointer rather than a layout.
 */
function whereKeys(root: SchemaNode): string[] {
  const defs = root.definitions ?? root.$defs ?? {};
  const deref = (node: SchemaNode | undefined, depth = 0): SchemaNode | undefined => {
    if (!node || depth > 8) return node;
    if (node.$ref)
      return deref(defs[node.$ref.replace(/^#\/(definitions|\$defs)\//, "")], depth + 1);
    // A nullable argument is `anyOf: [the type, null]`; the type is the half with content. One
    // with no null branch is a single-element `allOf`, which has only that half.
    const branches = node.anyOf ?? node.allOf;
    if (branches)
      return deref(
        branches.find((branch) => branch.$ref ?? branch.properties),
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
    "delete_task",
    "delete_trigger",
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
    "update_task",
    "update_trigger",
  ]);
  // The settings row holds the API key, and a bulk delete with no `where` empties a table.
  expect(names).not.toContain("set_api_key");
  expect(names).not.toContain("settings");

  // `delete_task` used to be the name the bulk mutation would have arrived under, so its absence
  // was the whole test. It is now the name the single-row one is deliberately given, and the
  // guard has to say which field is behind it instead. The footer is the driver's own claim
  // about the schema, which is why it still spells the GraphQL name.
  for (const [tool, field] of [
    ["delete_task", "deleteTaskSingle"],
    ["delete_trigger", "deleteTriggerSingle"],
    ["update_task", "updateTaskSingle"],
    ["update_trigger", "updateTriggerSingle"],
  ]) {
    const description = tools.find((each) => each.name === tool)?.description ?? "";
    expect(description).toContain(`GraphQL mutation: \`${field}\``);
  }
  // Nothing arrives carrying the qualifier that made an agent look for the tool without it.
  expect(names.filter((name) => name.endsWith("_single"))).toEqual([]);
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
  // Shared, the listing is ~167 kB and the largest tool ~27 kB, down from ~379 kB and ~44 kB on
  // 2.7.0 — drizzle-graphql 12 gave each column type only the operators it can use, and 2.9.0's
  // `inputField` took the relation filters out of the projection. The ~12 kB back on top of that
  // is the column descriptions from `server/graphql/docs.ts`, which is what they cost: a column
  // is described once and the text lands at every position it generates. The bounds sit above that
  // because the exact figure is not ours to hold: it went to ~528 kB when zod 4 became the
  // conversion path and back again on 2.2.0. What is being caught here is the order of magnitude
  // — a return to per-route copies trips this by 30×.
  const sizes = tools.map((tool) => [tool.name, JSON.stringify(tool).length] as const);
  for (const [name, size] of sizes) {
    expect(size, `${name} is ${(size / 1024).toFixed(0)} kB`).toBeLessThan(40_000);
  }
  expect(sizes.reduce((total, [, size]) => total + size, 0)).toBeLessThan(250_000);

  // The columns, and no relations. `TaskFilters.triggers` reaches `TriggerFilters`, which reaches
  // back through `RunFilters` and `StepFilters` — the closure that was most of the listing, for a
  // question no agent on this surface asked in a hundred calls. `inputField` prunes it from the
  // projection only: the same schema object serves the web app, which still has all three.
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
    "OR",
    "AND",
    "NOT",
  ]);
  const { schema } = await import("../server/graphql/schema.ts");
  const taskFilters = schema.getType("TaskFilters") as GraphQLInputObjectType;
  expect(Object.keys(taskFilters.getFields())).toContain("triggers");
});

/**
 * The prose an agent reads here is the same string the web app puts under its form field.
 *
 * `server/graphql/docs.ts` is the one copy and `tests/docs.test.ts` holds it against the schema
 * and the generated map. What is left to check is the last hop: that the projection carries a
 * field's description into the tool's JSON Schema rather than dropping it on the way, which is
 * the difference between an agent that knows what `prompt` is for and one that guesses.
 */
test("a tool tells an agent what its arguments mean", async () => {
  const { tools } = await client.listTools();
  const create = tools.find((tool) => tool.name === "create_task");
  const values = JSON.stringify(create?.inputSchema ?? {});
  expect(values).toContain(COLUMN_DOCS.tasks?.prompt);
  expect(values).toContain(COLUMN_DOCS.tasks?.model);
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

  await call("update_task", { where: { id: { eq: id } }, set: { enabled: false } });
  const trigger = (await call("create_trigger", {
    values: { taskId: id, kind: "cron", cron: "0 9 * * *" },
  })) as { createTrigger: { id: string } };
  expect(trigger.createTrigger.id).toBeTruthy();

  // Nothing has run, so `runs` is empty for it rather than missing.
  const runs = (await call("runs", { where: { taskId: { eq: id } } })) as { runs: unknown[] };
  expect(runs.runs).toEqual([]);

  await call("delete_task", { where: { id: { eq: id } } });
  const gone = (await call("tasks", { where: { id: { eq: id } } })) as { tasks: unknown[] };
  expect(gone.tasks).toEqual([]);
});

test("a question about a task's triggers is asked from the trigger end", async () => {
  const created = (await call("create_task", {
    values: { name: "webhooked", prompt: "wait for a POST" },
  })) as { createTask: { id: string } };
  const id = created.createTask.id;
  await call("create_trigger", {
    values: { taskId: id, kind: "event", event: "hook-filter-test" },
  });

  // The relation filter is pruned from the projection, so the reach it bought is gone from here
  // and the tool says so rather than ignoring the key. It was most of the listing's weight and
  // no agent sent one in a hundred logged calls.
  const refused = (await client.callTool({
    name: "tasks",
    arguments: { where: { triggers: { some: { event: { eq: "hook-filter-test" } } } } },
  })) as CallToolResult;
  expect(refused.isError).toBe(true);

  // And the question is still answerable, from the end that owns the foreign key.
  const found = (await call("triggers", {
    where: { event: { eq: "hook-filter-test" } },
  })) as { triggers: { taskId: string }[] };
  expect(found.triggers.map((trigger) => trigger.taskId)).toEqual([id]);

  await call("delete_task", { where: { id: { eq: id } } });
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
  const named = (name: string) => tools.find((tool) => tool.name === name)?.annotations;
  const flagged = (hint: "destructiveHint" | "idempotentHint") =>
    tools
      .filter((tool) => tool.annotations?.[hint])
      .map((tool) => tool.name)
      .sort();

  // The updates rewrite a row, `set_task_steps` replaces a whole flow, the deletes are the real
  // thing, and stopping a run throws away what it had done. Creating a task or starting a run is
  // none of those, and a client that stops to ask the operator should be spending that
  // interruption on the deletes.
  expect(flagged("destructiveHint")).toEqual([
    "delete_task",
    "delete_trigger",
    "set_task_steps",
    "stop_task",
    "update_task",
    "update_trigger",
  ]);

  // Reads are idempotent by definition; of the writes, only the deletes and a second `stop_task`
  // land the same way twice. `run_task` must not be here — running a task twice runs it twice.
  expect(flagged("idempotentHint")).toEqual([
    "delete_task",
    "delete_trigger",
    "models",
    "run_events",
    "run_steps",
    "runs",
    "schedule",
    "steps",
    "stop_task",
    "tasks",
    "triggers",
  ]);

  // Overriding one hint must not cost the others: they are merged, not replaced.
  expect(named("run_task")?.title).toBe("Run Task");
  expect(named("run_task")?.readOnlyHint).toBe(false);
  expect(named("create_task")?.destructiveHint).toBe(false);

  // Reads stay reads.
  expect(named("tasks")?.readOnlyHint).toBe(true);
});

test("a flow is written nested and read back flat, and says so", async () => {
  const { createTask } = await call("create_task", {
    values: { name: "roundtrip", prompt: "p", model: "m" },
  });
  const taskId = (createTask as { id: string }).id;

  await call("set_task_steps", {
    taskId,
    steps: [
      { kind: "agent", name: "look", prompt: "look" },
      {
        kind: "decision",
        name: "pick",
        prompt: "?",
        cases: ["yes", "no"],
        branches: [{ case: "yes", steps: [{ kind: "agent", name: "doit", prompt: "do" }] }],
      },
    ],
  });

  const { steps } = await call("steps", { where: { taskId: { eq: taskId } } });
  const rows = steps as Record<string, unknown>[];
  const under = rows.find((row) => row.name === "doit");
  expect(under?.parentId).toBe(rows.find((row) => row.name === "pick")?.id);
  expect(under?.branch).toBe("yes");

  // The shape `steps` hands back is not the shape this takes. Sending it as-is is refused, which
  // is the safe half.
  const asRead = await raw("set_task_steps", { taskId, steps: rows });
  expect(asRead.isError).toBe(true);
  expect(asRead.text).toContain("parentId");

  // Stripping the unrecognised keys is the obvious next move and the dangerous one: it is
  // accepted, and the tree collapses — `doit` leaves the `yes` arm and becomes a sibling that
  // now runs unconditionally. Nothing server-side can tell that apart from a flow meant to be
  // flat, so the tool description is what has to carry the warning. It is asserted below.
  const pruned = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    prompt: row.prompt,
    cases: row.cases,
  }));
  const { setTaskSteps } = await call("set_task_steps", { taskId, steps: pruned });
  const flattened = setTaskSteps as Record<string, unknown>[];
  expect(flattened.every((row) => row.parentId === null && row.branch === "")).toBe(true);

  const { tools } = await client.listTools();
  const described = tools.find((tool) => tool.name === "set_task_steps")?.description ?? "";
  expect(described).toContain("branches");
  expect(described).toMatch(/silently loses the arms/);

  await call("delete_task", { where: { id: { eq: taskId } } });
});

test("a call arriving here is an agent, whatever it asks for", async () => {
  const result = (await probe.callTool({ name: "settings" })) as CallToolResult;
  const [content] = result.content;
  if (content?.type !== "text") throw new Error("no text in the result of settings");
  expect(content.text).toContain("FORBIDDEN");
});
