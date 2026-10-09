import { fromMcpServersJson, validateServerConfig } from "@cubicecho/agent-mcp-pool/servers";
import type { McpConnectionInput, McpServersQuery } from "@/__generated__/graphql/graphql";
import { McpServersTransportEnum } from "@/__generated__/graphql/graphql";
import { parseJson } from "@/lib/json";

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

/** Rows the pool has no complaint about, for one field to be laid over and judged on its own. */
const FINE = { id: "new", label: "", enabled: true };
const FINE_STDIO = { ...FINE, transport: "stdio", command: "x" };
const FINE_HTTP = { ...FINE, transport: "http", url: "http://x" };

/** A connection field as the form holds it — text — turned into the row it would be saved in. */
const AS_ROW = {
  slug: (text: string) => ({ ...FINE_STDIO, slug: text.trim() }),
  command: (text: string) => ({ ...FINE_STDIO, command: text }),
  args: (text: string) => ({ ...FINE_STDIO, args: parseJson(text, "Args", []) }),
  env: (text: string) => ({ ...FINE_STDIO, env: parseJson(text, "Env", {}) }),
  url: (text: string) => ({ ...FINE_HTTP, url: text }),
  headers: (text: string) => ({ ...FINE_HTTP, headers: parseJson(text, "Headers", {}) }),
};

/**
 * What is wrong with one connection field, as it is typed.
 *
 * The answer is the pool's `validateServerConfig`, which is also what the server refuses a save
 * with, so a field is marked here for the reason the write would have come back with. That
 * check reads a whole row and a form validates a field, so the field is laid over a row with
 * nothing else wrong with it. The three jsonb columns are text here, and a missing bracket is
 * reported under its own box rather than as a toast on the way out.
 *
 * A slug is the one thing asked for that the pool does not ask for: it would fall back to the
 * row's id, and this server names every tool after the slug.
 */
export function fieldProblem(field: keyof typeof AS_ROW, text: string): string | undefined {
  if (field === "slug" && !text.trim()) {
    return "A server needs a slug — its tools are named after it.";
  }
  try {
    return validateServerConfig(AS_ROW[field](text))[0];
  } catch (error) {
    return (error as Error).message;
  }
}
