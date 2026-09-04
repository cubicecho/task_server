import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createYoga } from "graphql-yoga";
import { ensureSchema } from "./db/migrate.ts";
import type { GraphContext } from "./graphql/permissions.ts";
import { schema } from "./graphql/schema.ts";
import { mcpHandler, mountMcp } from "./mcp-endpoint.ts";
import { PORT, ROOT } from "./paths.ts";
import { mcp } from "./runner/mcp.ts";
import { drainQueue } from "./runner/run.ts";
import * as cleanup from "./scheduler/cleanup.ts";
import * as cron from "./scheduler/cron.ts";
import { mountWebhooks } from "./webhooks.ts";

await ensureSchema();

// The GraphQL schema comes from the tables, so a column added upstairs changes the API here.
// In dev that is regenerated into `schema.graphql` and `web/__generated__/graphql/graphql.ts`
// on boot; the production image has neither codegen nor sources to write. See `dev/codegen.ts`.
if (process.env.NODE_ENV !== "production") {
  await import("./dev/codegen.ts")
    .then((dev) => dev.runCodegen())
    .catch((error: unknown) => console.warn("[task-server] codegen skipped:", error));
}

const app = express();

// The web app's door, and the operator's. There is no authentication on this server, so the
// door is the whole of the identity: `/graphql` is the page the operator has open, `/mcp` is
// where agents call in, and `permissions.ts` is what that distinction buys.
const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  context: { caller: "operator" } satisfies GraphContext,
});
app.use(yoga.graphqlEndpoint, yoga);

// The same schema, offered to other clients as MCP tools, beside GraphQL rather than
// replacing it. What it exposes and why is in `mcp-endpoint.ts`.
mountMcp(app);

// The inbound end of an `event` trigger. POST only, so it cannot collide with the client's
// routes below however the sender spells the id.
mountWebhooks(app);

// In production the built client is served from the same origin.
const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/(graphql|mcp)$).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use(
  (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({ error: error.message });
  },
);

const server = app.listen(PORT, () => {
  console.log(`[task-server] http://localhost:${PORT}/graphql`);
  console.log(`[task-server] mcp: http://localhost:${PORT}/mcp`);
});

await mcp.sync();
await cron.sync();
cleanup.start();

// Runs that were waiting for a slot when this process last stopped are still waiting: the queue
// is rows in the run table, not memory, so a restart picks up where it left off.
await drainQueue();

const shutdown = async () => {
  cron.stop();
  cleanup.stop();
  await mcpHandler.close();
  await mcp.shutdown();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
