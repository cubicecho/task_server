import { hostname } from "node:os";
import {
  type AdvertisedEndpoint,
  airIdentifier,
  createServerCard,
  discoveryMiddleware,
  hostSlug,
} from "@cubicecho/mcp-discovery";
import type express from "express";
// Default import, as in `mcp-endpoint.ts`: Node's own JSON modules only export a default.
import pkg from "../../package.json" with { type: "json" };
import { MCP_PATH } from "../mcp-endpoint.ts";

/**
 * How this server describes `/mcp` to a client that has not connected yet: an AI Catalog at
 * `/.well-known/ai-catalog.json` that lists one MCP Server Card, served at `/mcp/server-card`.
 *
 * Both are public by design, and say nothing a client could not learn by connecting. There is no
 * authentication on this server, so the card asks for no header: a client that reads it knows it
 * can call straight in.
 */

/** The reverse-DNS namespace every card name starts with; the host's slug is appended to it. */
const CARD_NAMESPACE = "io.github.cubicecho.task-server";

/** What follows the host's slug in the catalog entry's `urn:air` publisher. */
const AIR_PUBLISHER = "task-server";

/** The endpoint's name under the host: the last part of its card name and its `urn:air` id. */
const ENDPOINT_NAME = "tasks";

/** The card's description; a Server Card allows 100 characters. */
const DESCRIPTION =
  "Scheduled AI tasks: write, run and watch tasks, their triggers and their runs.";

/** The project's source, shown on the card. */
const REPOSITORY = { url: "https://github.com/cubicecho/task_server", source: "github" } as const;

/**
 * The MCP endpoints this server makes discoverable: `/mcp`, the only one.
 *
 * @param [host] - The machine's hostname, which keeps two task servers on one network apart.
 * @returns The endpoint, with a card builder that names the URL the request came in on.
 */
export function discoveryEndpoints(host = hostname()): AdvertisedEndpoint[] {
  const slug = hostSlug(host);
  return [
    {
      path: MCP_PATH,
      identifier: airIdentifier(`${slug}.${AIR_PUBLISHER}`, ENDPOINT_NAME),
      card: ({ endpointUrl }) =>
        createServerCard({
          name: `${CARD_NAMESPACE}.${slug}/${ENDPOINT_NAME}`,
          version: pkg.version,
          title: `Task Server on ${host}`,
          description: DESCRIPTION,
          repository: REPOSITORY,
          remotes: [{ type: "streamable-http", url: endpointUrl }],
        }),
    },
  ];
}

/**
 * Mounts the catalog and the card. First on the app: they are public, and the client app's
 * fallback below would otherwise answer `/.well-known/ai-catalog.json` with the web page.
 *
 * @param app - The Express app.
 */
export function mountDiscovery(app: express.Application) {
  const endpoints = discoveryEndpoints();
  app.use(discoveryMiddleware(() => endpoints));
}
