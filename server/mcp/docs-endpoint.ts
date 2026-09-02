import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpHandler } from "@cubicecho/graphql-mcp";
import express from "express";
import pkg from "../../package.json" with { type: "json" };
import { schema } from "../graphql/schema.ts";
import { documentTools } from "./documents.ts";

/**
 * The document-driven MCP surface, mounted beside the generated one at `/mcp-docs`.
 *
 * Both endpoints answer for the same server and the same database; what differs is where the
 * tools come from. `/mcp` projects root fields and hands an agent the schema's own shapes;
 * this one projects the operations in `tools.graphql` and hands it shapes a person chose. They
 * run side by side so the two can be driven against each other rather than argued about.
 *
 * `include: []` is what leaves the generated tools out: a present but empty rule list matches
 * nothing, so the listing is the custom tools alone.
 */
export const docsMcpHandler = createHttpHandler({
  schema,
  name: "task-server",
  version: pkg.version,
  include: [],
  tools: documentTools(schema, path.dirname(fileURLToPath(import.meta.url))),
});

export function mountDocsMcp(app: express.Application, route = "/mcp-docs") {
  app.all(route, express.json(), docsMcpHandler);
}
