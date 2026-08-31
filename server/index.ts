import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createYoga } from "graphql-yoga";
import { ensureSchema } from "./db/migrate.ts";
import { schema } from "./graphql/schema.ts";
import { mcpHandler, mountMcp } from "./mcp-endpoint.ts";
import { PORT, ROOT } from "./paths.ts";
import { mcp } from "./runner/mcp.ts";
import * as cron from "./scheduler/cron.ts";

await ensureSchema();

const app = express();

const yoga = createYoga({ schema, graphqlEndpoint: "/graphql" });
app.use(yoga.graphqlEndpoint, yoga);

// The same schema, offered to other clients as MCP tools, beside GraphQL rather than
// replacing it. What it exposes and why is in `mcp-endpoint.ts`.
mountMcp(app);

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

const shutdown = async () => {
  cron.stop();
  await mcpHandler.close();
  await mcp.shutdown();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
