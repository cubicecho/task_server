import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpHandler } from "@cubicecho/graphql-mcp";
import express from "express";
import { Source } from "graphql";
import pkg from "../../package.json" with { type: "json" };
import { schema } from "../graphql/schema.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The document-driven MCP surface, mounted beside the generated one at `/mcp-docs`.
 *
 * Both endpoints answer for the same server and the same database; what differs is where the
 * tools come from. `/mcp` projects root fields and hands an agent the schema's own shapes —
 * `where: { id: { eq: … } }` to fetch one task, and 155 kB of generated filter types before it
 * can call anything. This one projects the operations in `tools.graphql`: the tool is the operation, so
 * its name, its flat named variables and the comment block above it are what an agent meets, and
 * the filter ceremony stays inside the document. The document itself is printed under the
 * description, which is the driver's answer to a question the hand-rolled version of this left
 * open — an agent could not otherwise know which fields come back.
 *
 * The cost is that this is a curated surface rather than a projection, and a new column is not
 * queryable until a document asks for it. That is the trade being made deliberately: the
 * agent-facing API becomes a thing under review in `tools.graphql`, not a shadow of the tables.
 *
 * `include: []` is what leaves the generated tools out — a present but empty rule list matches
 * nothing, so the listing is the operations alone. It does not touch them: `include` governs
 * how the *schema* is projected, and an operation is code we wrote.
 *
 * Every document is parsed and validated against the schema when this module loads, so a
 * mistyped field or an unknown variable type is a boot failure naming the file and position
 * rather than a tool that fails the first time an agent calls it. That is why the sources are
 * `Source`s and not strings: the name is what the error gets to quote.
 */
export const docsMcpHandler = createHttpHandler({
  schema,
  name: "task-server",
  version: pkg.version,
  include: [],
  operations: globSync(path.join(here, "*.graphql")).map(
    (file) => new Source(readFileSync(file, "utf8"), path.basename(file)),
  ),
  // Read off the operation name, which is a better signal here than on the generated surface:
  // these names were chosen rather than emitted, so `delete_task` means what the convention
  // says it does. `stop_task` matches nothing and keeps the conservative default — destructive
  // is right for it, since an aborted run is discarded rather than resumed.
  mutationHints: "byName",
});

export function mountDocsMcp(app: express.Application, route = "/mcp-docs") {
  app.all(route, express.json(), docsMcpHandler);
}
