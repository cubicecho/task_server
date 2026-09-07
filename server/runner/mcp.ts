import { type McpConnection, McpPool, probe as probeConfig } from "@cubicecho/agent-mcp-pool";
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
 */
export const mcp = new McpPool({
  load: () => db.select().from(mcpServers),
  clientName: "task-server",
});

/** What the "Test connection" button calls, introducing itself as this server. */
export const probe = (config: McpConnection) => probeConfig(config, "task-server");

export type { McpConnection };
