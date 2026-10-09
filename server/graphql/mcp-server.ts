import { validateServerConfig } from "@cubicecho/agent-mcp-pool";
import { unfiredProblems } from "../../shared/hooks.ts";
import { hookProblems } from "../runner/hooks.ts";

/**
 * What an MCP server row has to be before it is stored, asked the same way by every write.
 *
 * There are two ways a row arrives: the generated mutations, and an agent spec whose bundle the
 * operator chose to create a server from. They are held to one set of rules by asking them here
 * rather than by each remembering to — a server that the form would have refused must not get
 * in through a file.
 */

/** The columns' own defaults, which a create that leaves them out is going to get. */
export const NEW_MCP_SERVER = { id: "new", label: "", enabled: true, transport: "stdio" };

/**
 * What is wrong with the row apart from its hooks, by the pool's own `validateServerConfig` —
 * the same rules the form reads a field at a time.
 *
 * The hooks are checked apart from the shape: they have a rule of this host's on top of the
 * pool's, and their own code for a client that wants the list.
 */
export const shapeProblems = (row: Record<string, unknown>): string[] =>
  validateServerConfig({ ...row, hooks: null });

/**
 * A row's hook problems, split by whether the hook could ever run.
 *
 * `broken` is a hook the pool cannot make sense of. `unfired` is one that is well formed and
 * bound to an event this host never reaches, which a write through the API refuses and an
 * import only remarks on: the document was written for a host that does fire it, and the row is
 * no worse for carrying a hook that waits.
 */
export function splitHookProblems(hooks: unknown): { broken: string[]; unfired: string[] } {
  const unfired = Array.isArray(hooks) ? unfiredProblems(hooks) : [];
  return {
    broken: hookProblems(hooks).filter((problem) => !unfired.includes(problem)),
    unfired,
  };
}
