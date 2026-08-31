import type { McpConnectionInput, McpServersQuery } from "@/gql/graphql";
import { McpServersTransportEnum } from "@/gql/graphql";

/** What a pasted config can fill in: the connection fields, and a slug if the paste named one. */
export interface PastedConfig {
  slug?: string;
  transport: McpServersTransportEnum;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

/** Parses a JSON field from the form, naming the field when it will not parse. */
export function parseJson<T>(text: string, field: string, fallback: T): T {
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${field} is not valid JSON.`);
  }
}

/**
 * Reads a `.mcp.json`-shaped paste into the form.
 *
 * People have this config already — in `.mcp.json`, in a README, in another tool's settings —
 * and retyping it into six fields is where the typos come from. All three nestings are
 * accepted, since which one you get depends on how much of the file was copied:
 *
 *   { "mcpServers": { "fs": { … } } }   the whole file
 *   { "fs": { … } }                     one named entry
 *   { "command": "npx", … }             just the body
 */
export function parseMcpJson(text: string): PastedConfig {
  const parsed = parseJson<Record<string, unknown>>(text, "The pasted config", {});
  const servers = (parsed.mcpServers ?? parsed.servers ?? parsed) as Record<string, unknown>;

  let slug = "";
  let body = servers;
  if (!("command" in servers) && !("url" in servers) && !("type" in servers)) {
    const [first] = Object.entries(servers);
    if (!first) throw new Error("No server found in that config.");
    [slug] = first;
    body = first[1] as Record<string, unknown>;
  }

  const url = typeof body.url === "string" ? body.url : "";
  const declared = String(body.type ?? body.transport ?? "");
  // `type` is the modern spelling and comes in several flavours of http; a url without a type
  // is http too, since a stdio server has nothing to point at.
  const transport =
    declared === "stdio" || (!declared && !url)
      ? McpServersTransportEnum.Stdio
      : McpServersTransportEnum.Http;

  return {
    ...(slug ? { slug } : {}),
    transport,
    command: typeof body.command === "string" ? body.command : "",
    args: JSON.stringify(Array.isArray(body.args) ? body.args : []),
    env: JSON.stringify(body.env ?? {}),
    url,
    headers: JSON.stringify(body.headers ?? {}),
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
