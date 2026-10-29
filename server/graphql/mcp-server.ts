import { validateServerConfig } from "@cubicecho/agent-mcp-pool";
import { mcpServers } from "../db/schema.ts";

/**
 * What an MCP server row has to be before it is stored, asked the same way by every write.
 *
 * There are two ways a row arrives: the generated mutations, and an agent spec whose bundle the
 * operator chose to create a server from. They are held to one set of rules by asking them here
 * rather than by each remembering to — a server that the form would have refused must not get
 * in through a file.
 */

/**
 * The columns' own defaults, which a create that leaves them out is going to get. The id is the
 * exception: the row has none until it is written, and the check wants one to name.
 */
export const NEW_MCP_SERVER = {
  id: "new",
  label: mcpServers.label.default,
  enabled: mcpServers.enabled.default,
  transport: mcpServers.transport.default,
};

/**
 * What is wrong with the row apart from its hooks, by the pool's own `validateServerConfig` —
 * the same rules the form reads a field at a time.
 *
 * The hooks are checked apart from the shape, by `hookProblems`, since they have their own code
 * for a client that wants the list.
 */
export const shapeProblems = (row: Record<string, unknown>): string[] =>
  validateServerConfig({ ...row, hooks: null });
