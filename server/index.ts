import fs from "node:fs";
import path from "node:path";
import { createHttpHandler } from "@cubicecho/graphql-mcp";
import express from "express";
import { createYoga } from "graphql-yoga";
import { ensureSchema } from "./db/migrate.ts";
import { schema } from "./graphql/schema.ts";
import { PORT, ROOT } from "./paths.ts";
import { mcp } from "./runner/mcp.ts";
import * as cron from "./scheduler/cron.ts";

ensureSchema();

const app = express();

const yoga = createYoga({ schema, graphqlEndpoint: "/graphql" });
app.use(yoga.graphqlEndpoint, yoga);

/**
 * The same schema, offered to agents as MCP tools.
 *
 * A task server whose own API is a set of tools can be driven by an agent — "add a task that
 * checks the build every morning" — which is the shortest path from this being a CRUD app to
 * being something an assistant operates. It mounts beside GraphQL rather than replacing it.
 */
app.post("/mcp", express.json(), createHttpHandler({ schema }));

// In production the built client is served from the same origin.
const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/(graphql|mcp)).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use(
  (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({ error: error.message });
  },
);

const server = app.listen(PORT, () => {
  console.log(`[task-server] http://localhost:${PORT}/graphql`);
});

await mcp.sync();
await cron.sync();

const shutdown = async () => {
  cron.stop();
  await mcp.shutdown();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
