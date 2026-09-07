import type { McpConnection } from "@cubicecho/agent-mcp-pool";
import { McpPool } from "@cubicecho/agent-mcp-pool";
// What this process tells a dialled server it is, beside the name. Default import for the
// reason `mcp-endpoint.ts` uses one: Node's own JSON modules export only a default, and the
// container runs this file through Node rather than tsx.
import pkg from "../../package.json" with { type: "json" };
import { db } from "../db/client.ts";
import { mcpServers } from "../db/schema.ts";

/**
 * This server's MCP pool: one long-lived client per configured server, offering their tools to
 * a run as `<slug>__<tool name>`.
 *
 * The pool itself is `@cubicecho/agent-mcp-pool`'s. What is this server's is what is below — where
 * the configured servers come from, and what this process calls itself when it connects.
 * `load` is the seam that used to be an `import { db }` inside the pool: it is called whenever
 * `sync()` reconciles without being handed rows, which is the boot path and every `onWrite`
 * hook on the table.
 *
 * The name and the version are one thing — the `clientInfo` of the handshake, and the whole of
 * what a dialled server can log or gate on. Left to itself the pool reports its own version, so
 * a server would be told this process is `task-server` at whatever agent-mcp-pool happens to be;
 * it is the same string `/mcp` already answers with, so a server this one dials and a client that
 * dials it read one version.
 */
export const mcp = new McpPool({
  load: () => db.select().from(mcpServers),
  clientName: "task-server",
  clientVersion: pkg.version,
});

/**
 * What the "Test connection" button calls.
 *
 * `mcp.probe` rather than the free `probe`, since 0.7.0 closed
 * [agent-mcp-pool#3](https://github.com/cubicecho/agent-mcp-pool/issues/3): the pool has already
 * been told who this process is, so there is no second copy of the name — or, since 2.3.0, of the
 * version — here to introduce a probe as one thing and the pool as another, a disagreement that
 * shows up only in a remote server's logs.
 */
export const probe = (config: McpConnection) => mcp.probe(config);

export type { McpConnection };
