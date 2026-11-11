import type { ResourceText } from "@cubicecho/agent-mcp-pool";
import { mcp } from "./mcp.ts";

/**
 * A run's artifact read back from the server that made it, for a person to preview.
 *
 * Like the prompts beside it, this is the protocol's other half — `resources/read`, through the
 * pool's `readResource` — and goes to a person, never to a run. The text is
 * read fresh on every call rather than kept with the run: the artifact row says what was linked,
 * and the server is the only one that knows what it says now.
 */

/**
 * The most text a preview is handed. A document a person reads in a dialog is well under this;
 * a log or a dump that is not would otherwise cross the wire whole to be scrolled past.
 */
export const PREVIEW_MAX_CHARS = 200_000;

/**
 * One resource as text. Binary parts arrive named with their type and size, the way the pool
 * names them for a model, so the bytes never reach the browser.
 *
 * The capability check is the pool's: a server whose handshake did not declare `resources` is an
 * `McpPoolError` of code `unsupported` before anything is sent, which is "this server cannot
 * preview" rather than the "method not found" a server answers that reads as a broken one.
 */
export async function read(serverId: string, uri: string): Promise<ResourceText> {
  // A reconnect owed from a write that just landed is paid off first, as `mcpPrompts` does.
  await mcp.flush();
  return mcp.readResource(serverId, uri, { maxChars: PREVIEW_MAX_CHARS });
}
