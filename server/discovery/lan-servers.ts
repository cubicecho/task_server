import type { LanServer, ServerWatch, ServerWatchHandlers } from "@cubicecho/mcp-discovery/mdns";
import type { McpServerRow } from "../db/schema.ts";

/**
 * MCP servers found on the local network, offered as suggestions for the `mcp_servers` table.
 *
 * Only ever offered. mDNS and Server Cards are unauthenticated, so anything on the LAN can
 * announce any name and any URL, and a server added here hands its tools to every run. Adding
 * one is the operator's decision, through the same form and the same checks as a server typed
 * in by hand; nothing here writes a row.
 */

/** A found server, as the MCP servers page offers it. */
export interface LanMcpServer {
  /** Unique on the network: the announcing host's instance name and the card's name. */
  key: string;
  /** The card's name, e.g. `io.github.cubicecho.mcp-skills.nas/skills`. */
  cardName: string;
  /** What the card calls it for a person; empty when it gives no title. */
  title: string;
  description: string;
  version: string;
  /** The mDNS instance name of the host that announced it, e.g. `MCP Skills on nas`. */
  host: string;
  /** The streamable-HTTP endpoint to connect to. */
  url: string;
  /** Headers the card says a client must send and gives no value for, e.g. `Authorization`. */
  requiredHeaders: string[];
  /** A slug no row uses yet, to start the form from. */
  suggestedSlug: string;
  /** The slug of the row that already points at `url`, or null when none does. */
  addedAs: string | null;
}

/** The columns of a row this module reads. */
type ConfiguredServer = Pick<McpServerRow, "slug" | "transport" | "url">;

/** What the watch needs from the server. */
export interface LanServersDeps {
  /** Whether to watch; read on every `sync`, so it follows `settings.lanDiscovery`. */
  isWanted: () => boolean;
  /** The name this server announces itself under, so it never offers itself. */
  ownInstanceName: string;
  /** The configured servers, to tell which found ones are already added and which slugs are taken. */
  servers: () => Promise<ConfiguredServer[]>;
  /** Writes a line to the log. */
  log: (message: string) => void;
  /** Starts the network watch: `watchServers` from `@cubicecho/mcp-discovery/mdns`, replaced in tests. */
  watch: (handlers: ServerWatchHandlers) => Promise<Pick<ServerWatch, "stop">>;
}

/** The servers found on the local network. */
export interface LanServers {
  /** Starts or stops watching to match `isWanted()`. */
  sync: () => Promise<void>;
  /** Every found server, with whether it is already added. Empty while not watching. */
  list: () => Promise<LanMcpServer[]>;
  /** Stops watching; call on shutdown. */
  close: () => Promise<void>;
}

/** A slug may hold letters, digits, `_` and `-`, which is what the pool can namespace tools by. */
const NOT_SLUG = /[^a-z0-9_-]+/g;

/**
 * The same endpoint URL however it was written, so a row typed by hand matches the one found.
 *
 * @param url - A URL.
 * @returns It without a trailing slash, or as given when it does not parse.
 */
function sameUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

/**
 * A slug for a found server that no row uses yet.
 *
 * @param cardName - The card's name; its part after the last `/` is the server's own name.
 * @param taken - The slugs already in use.
 * @returns E.g. `skills`, or `skills-2` when `skills` is taken.
 */
export function freeSlug(cardName: string, taken: ReadonlySet<string>): string {
  const own = cardName.slice(cardName.lastIndexOf("/") + 1);
  const base =
    own
      .toLowerCase()
      .replace(NOT_SLUG, "-")
      .replace(/^-+|-+$/g, "") || "server";
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix++) {
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

/**
 * Builds the LAN watch; nothing is watched until the first `sync`.
 *
 * @param deps - The setting, this server's own name, its rows, and the network watch.
 * @returns The watch.
 *
 * @remarks
 * Its own announcement, and a card with no streamable-HTTP URL that can be used as it stands,
 * are left out. A router's cards are not: an aggregate of many servers is the most useful thing a
 * task server can find.
 */
export function createLanServers(deps: LanServersDeps): LanServers {
  const found = new Map<string, LanServer>();
  let watch: Pick<ServerWatch, "stop"> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const isOffered = (server: LanServer): boolean => {
    const isSelf = server.host.name === deps.ownInstanceName;
    return isSelf === false && server.connection !== null;
  };

  const handlers: ServerWatchHandlers = {
    onUp: (server) => {
      if (isOffered(server)) {
        found.set(server.key, server);
      }
    },
    onDown: (server) => {
      found.delete(server.key);
    },
    onError: (error) => deps.log(`[discovery] ${error.message}`),
  };

  const stop = async (): Promise<void> => {
    if (watch === null) {
      return;
    }
    const stopping = watch;
    watch = null;
    found.clear();
    await stopping.stop();
    deps.log("[discovery] stopped watching the local network");
  };

  const apply = async (): Promise<void> => {
    if (deps.isWanted() === false) {
      await stop();
      return;
    }
    if (watch) {
      return;
    }
    try {
      watch = await deps.watch(handlers);
      deps.log("[discovery] watching the local network for MCP servers");
    } catch (error) {
      deps.log(`[discovery] could not watch the local network: ${String(error)}`);
    }
  };

  // One after another, so a quick off-on-off never leaves two watches running.
  const enqueue = (step: () => Promise<void>): Promise<void> => {
    queue = queue.then(step, step);
    return queue;
  };

  const list = async (): Promise<LanMcpServer[]> => {
    if (found.size === 0) {
      return [];
    }
    const rows = await deps.servers();
    const taken = new Set(rows.map((row) => row.slug));
    return [...found.values()].flatMap((server): LanMcpServer[] => {
      const { card, connection } = server;
      if (!connection) {
        return [];
      }
      const added = rows.find(
        (row) => row.transport === "http" && sameUrl(row.url) === sameUrl(connection.url),
      );
      return [
        {
          key: server.key,
          cardName: card.name,
          title: card.title ?? "",
          description: card.description,
          version: card.version,
          host: server.host.name,
          url: connection.url,
          requiredHeaders: connection.requiredHeaders,
          suggestedSlug: freeSlug(card.name, taken),
          addedAs: added?.slug ?? null,
        },
      ];
    });
  };

  return { sync: () => enqueue(apply), close: () => enqueue(stop), list };
}
