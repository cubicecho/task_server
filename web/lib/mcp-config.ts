import { fromMcpServersJson } from "@cubicecho/agent-mcp-pool/servers";
import type { McpConnectionInput, McpServersQuery } from "@/__generated__/graphql/graphql";
import { McpServersTransportEnum } from "@/__generated__/graphql/graphql";

/** What a pasted config can fill in: the connection fields, a slug if the paste named one. */
export interface PastedConfig {
  slug?: string;
  /** Only ever `false`, for a paste that says `disabled`; a paste does not tick a box. */
  enabled?: false;
  transport: McpServersTransportEnum;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

/** The id handed to a paste that is one server's body, which no key in a config can spell. */
const UNNAMED = "\u0000";

/**
 * Reads a `.mcp.json`-shaped paste into the form.
 *
 * People have this config already — in `.mcp.json`, in a README, in another tool's settings —
 * and retyping it into six fields is where the typos come from. The reading is the pool's own
 * `fromMcpServersJson`, so the three nestings a copy can arrive in, the spellings of http and
 * the refusal of an SSE server are the ones every host on the pool gives. What is left here is
 * the form's shape: JSON columns as text, and the first server of a paste that holds several.
 *
 * `env` is passed empty rather than left to default, so a `${VAR}` reads the same in a test as
 * in a browser: it stays as written for the operator to fill in, and only a `${VAR:-default}`
 * is resolved.
 */
export function parseMcpJson(text: string): PastedConfig {
  const [row] = fromMcpServersJson(text, { env: {}, name: UNNAMED });
  const stdio = row.transport === "stdio";

  return {
    ...(row.slug && row.slug !== UNNAMED ? { slug: row.slug } : {}),
    ...(row.enabled ? {} : { enabled: false }),
    transport: stdio ? McpServersTransportEnum.Stdio : McpServersTransportEnum.Http,
    command: stdio ? row.command : "",
    args: JSON.stringify((stdio && row.args) || []),
    env: JSON.stringify((stdio && row.env) || {}),
    url: stdio ? "" : row.url,
    headers: JSON.stringify((!stdio && row.headers) || {}),
  };
}

/**
 * A saved row's connection fields, in the shape `testMcpServer` takes.
 *
 * The JSON columns arrive as `unknown` — the scalar carries no shape — so this is the one
 * place that asserts what they hold.
 */
export function toConnection(server: McpServersQuery["mcpServers"][number]): McpConnectionInput {
  return {
    transport: server.transport,
    command: server.command,
    args: (server.args as string[] | null) ?? [],
    env: server.env ?? {},
    url: server.url,
    headers: server.headers ?? {},
  };
}
