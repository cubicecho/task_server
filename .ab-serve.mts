// One task server for one arm: its own database, both MCP surfaces mounted, the same fixture.
import express from "express";
import { mountMcp } from "./server/mcp-endpoint.ts";
import { mountDocsMcp } from "./server/mcp/docs-endpoint.ts";

const { ensureSchema } = await import("./server/db/migrate.ts");
await ensureSchema();
const { db } = await import("./server/db/client.ts");
const { tasks, triggers, steps, runs } = await import("./server/db/schema.ts");

const task = async (values: Record<string, unknown>) =>
  (await db.insert(tasks).values(values as never).returning())[0];

// Two that work, three that are set up but can never fire, and one with a flow to edit.
const digest = await task({ name: "nightly digest", prompt: "summarise the day", model: "gpt-4o-mini" });
const stale = await task({ name: "stale branches", prompt: "list branches older than 30 days" });
const orphan = await task({ name: "orphan report", prompt: "who owns what" });
const muted = await task({ name: "muted alerts", prompt: "check the alert queue" });
const archived = await task({ name: "archived audit", prompt: "quarterly audit", enabled: false });
const deploy = await task({ name: "deploy check", prompt: "look at the last deploy" });

await db.insert(triggers).values([
  { taskId: digest.id, kind: "cron", cron: "0 22 * * *", timezone: "Europe/London" },
  { taskId: stale.id, kind: "event", event: "branch-sweep" },
  // muted alerts has a trigger, switched off. archived audit has a live trigger on a dead task.
  { taskId: muted.id, kind: "cron", cron: "*/15 * * * *", enabled: false },
  { taskId: archived.id, kind: "cron", cron: "0 3 1 * *", timezone: "UTC" },
  { taskId: deploy.id, kind: "event", event: "deploy-finished" },
]);

// An existing flow, for the arm that has to amend one rather than write it fresh.
const [decision] = await db
  .insert(steps)
  .values({
    taskId: deploy.id,
    position: 0,
    kind: "decision",
    name: "healthy?",
    prompt: "did the deploy come up clean?",
    cases: ["yes", "no"],
  })
  .returning();
await db.insert(steps).values([
  {
    taskId: deploy.id,
    parentId: decision.id,
    branch: "no",
    position: 0,
    name: "page",
    prompt: "wake someone up",
  },
  {
    taskId: deploy.id,
    parentId: decision.id,
    branch: "yes",
    position: 0,
    name: "announce",
    prompt: "post the release notes",
  },
]);

const [blocking] = await db
  .insert(runs)
  .values({
    taskId: digest.id,
    status: "error",
    startedAt: new Date(Date.now() - 3_600_000),
    finishedAt: new Date(Date.now() - 3_590_000),
    error: "model refused",
  })
  .returning();
await db.insert(runs).values([
  {
    taskId: digest.id,
    status: "ok",
    startedAt: new Date(Date.now() - 90_000_000),
    finishedAt: new Date(Date.now() - 89_000_000),
    output: "nothing notable",
    totalTokens: 812,
  },
  {
    taskId: digest.id,
    status: "skipped",
    startedAt: new Date(Date.now() - 3_595_000),
    finishedAt: new Date(Date.now() - 3_580_000),
    error: "task already running",
    blockedBy: blocking.id,
    attempts: 4,
  },
  {
    taskId: deploy.id,
    status: "ok",
    startedAt: new Date(Date.now() - 7_200_000),
    finishedAt: new Date(Date.now() - 7_100_000),
    output: "clean",
    totalTokens: 430,
  },
]);

// H3: the curated operations, plus a read-only escape hatch for questions nobody anticipated.
// `include: []` exposes no generated tool, so `metaTools.include` has to name what `execute`
// may reach — it defaults to the server's own rules, which here allow nothing at all.
const { createHttpHandler } = await import("@cubicecho/graphql-mcp");
const { documentTools } = await import("./server/mcp/documents.ts");
const { schema } = await import("./server/graphql/schema.ts");
const hybrid = createHttpHandler({
  schema,
  name: "task-server",
  version: "0",
  include: [],
  tools: documentTools(schema, "server/mcp"),
  metaTools: {
    tools: ["search", "introspect", "execute"],
    include: ["Query.*"],
    allowMutations: false,
  },
});

// The fixture inserts rows directly, which bypasses the `onWrite` hooks that rebuild the cron
// schedule — so without this `get_schedule` is empty for every seeded trigger and an arm that
// trusts it draws the wrong conclusion. That is a harness artifact, not a surface property.
const cron = await import("./server/scheduler/cron.ts");
await cron.sync();

const app = express();
mountMcp(app);
mountDocsMcp(app);
app.all("/mcp-hybrid", express.json(), hybrid);
app.listen(Number(process.env.PORT), "127.0.0.1", () => console.log(`up on ${process.env.PORT}`));
