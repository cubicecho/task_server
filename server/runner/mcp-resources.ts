import type { ResourceText } from "@cubicecho/agent-mcp-pool";
import { mcp } from "./mcp.ts";

/**
 * A run's artifact read back from the server that made it, for a person to preview, and the
 * listing a person picks a resource from to name it in a prompt.
 *
 * Like the prompts beside it, this is the protocol's other half — `resources/read`, through the
 * pool's `readResource` — and goes to a person. The text is read fresh on every call rather than
 * kept with the run: the artifact row says what was linked, and the server is the only one that
 * knows what it says now. A run's own reads, of the resources its prompt names, are
 * `prompt-resources.ts`.
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

/**
 * One resource or resource template on offer, for the picker that names one in a prompt.
 *
 * `uri` is a template's own `uriTemplate` where `template` is set — the picker fills its
 * variables before it inserts anything. `serverSlug` is what the placeholder names, and `server`
 * the row id that `complete` is addressed with.
 */
export interface McpResourceRow {
  server: string;
  serverSlug: string;
  serverLabel: string;
  template: boolean;
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

/**
 * Every resource and template every resource-serving server offers, in configuration order:
 * fixed resources first within a server, then its templates.
 *
 * A server that failed to answer is one with none, as `mcpPrompts.list` treats it, and for its
 * reason.
 */
export async function list(): Promise<McpResourceRow[]> {
  await mcp.flush();

  const known = new Map(mcp.state().map((server) => [server.id, server]));
  const listings = await mcp.resources();
  return listings.flatMap(({ serverId, resources, templates }) => {
    const server = known.get(serverId);
    const base = {
      server: serverId,
      serverSlug: server?.slug ?? serverId,
      serverLabel: server?.label ?? serverId,
    };
    return [
      ...resources.map((resource) => ({
        ...base,
        template: false,
        uri: resource.uri,
        name: resource.name,
        title: resource.title ?? "",
        description: resource.description ?? "",
        mimeType: resource.mimeType ?? "",
      })),
      ...templates.map((template) => ({
        ...base,
        template: true,
        uri: template.uriTemplate,
        name: template.name,
        title: template.title ?? "",
        description: template.description ?? "",
        mimeType: template.mimeType ?? "",
      })),
    ];
  });
}

/**
 * What a server suggests for one variable of a resource template, given what is typed so far and
 * the variables already filled in. None, never an error, for a server that cannot complete.
 */
export const complete = (
  server: string,
  uriTemplate: string,
  variable: { name: string; value: string },
  context: Record<string, string>,
) => mcp.complete(server, { type: "ref/resource", uri: uriTemplate }, variable, context);
