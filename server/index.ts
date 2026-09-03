import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createYoga } from "graphql-yoga";
import { ensureSchema } from "./db/migrate.ts";
import { schema } from "./graphql/schema.ts";
import { docsMcpHandler, mountDocsMcp } from "./mcp/docs-endpoint.ts";
import { mcpHandler, mountMcp } from "./mcp-endpoint.ts";
import { PORT, ROOT } from "./paths.ts";
import { mcp } from "./runner/mcp.ts";
import * as cleanup from "./scheduler/cleanup.ts";
import * as cron from "./scheduler/cron.ts";
import { mountWebhooks } from "./webhooks.ts";

await ensureSchema();

// The GraphQL schema comes from the tables, so a column added upstairs changes the API here.
// In dev that is regenerated into `schema.graphql` and `src/gql/graphql.ts` on boot; the
// production image has neither codegen nor sources to write. See `dev/codegen.ts`.
if (process.env.NODE_ENV !== "production") {
  await import("./dev/codegen.ts")
    .then((dev) => dev.runCodegen())
    .catch((error: unknown) => console.warn("[task-server] codegen skipped:", error));
}

const app = express();

const yoga = createYoga({ schema, graphqlEndpoint: "/graphql" });
app.use(yoga.graphqlEndpoint, yoga);

// The same schema, offered to other clients as MCP tools, beside GraphQL rather than
// replacing it. What it exposes and why is in `mcp-endpoint.ts`.
mountMcp(app);
// The document-driven surface, live beside the generated one while the two are compared.
mountDocsMcp(app);

// The inbound end of an `event` trigger. POST only, so it cannot collide with the client's
// routes below however the sender spells the id.
mountWebhooks(app);

// In production the built client is served from the same origin.
const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/(graphql|mcp|mcp-docs)$).*/, (_req, res) =>
    res.sendFile(path.join(dist, "index.html")),
  );
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

const shutdown = async () => {
  cron.stop();
  cleanup.stop();
  await mcpHandler.close();
  await docsMcpHandler.close();
  await mcp.shutdown();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
