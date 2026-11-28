import { hostname } from "node:os";
import { createAdvertiser, watchServers } from "@cubicecho/mcp-discovery/mdns";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { mcpServers, SETTINGS_ID, settings } from "../db/schema.ts";
import { PORT } from "../paths.ts";
import { AFTER_COMMIT_MS } from "../runner/run.ts";
import { createLanServers } from "./lan-servers.ts";

/**
 * This server on the local network, both ways: announcing `/mcp` over mDNS, and watching for the
 * MCP servers others announce. Each half follows its own column on the settings row
 * (`lanAdvertise`, `lanDiscovery`), and both are off until the operator turns them on.
 *
 * mDNS needs multicast, which Docker's default bridge network drops: a container that should be
 * found, or should find others, runs with `network_mode: host`.
 */

/** The name this server announces itself under, and so the one it skips when it browses. */
const INSTANCE_NAME = `Task Server on ${hostname()}`;

/** The two switches, as last read from the settings row. Off until the first `sync`. */
const wanted = { lanAdvertise: false, lanDiscovery: false };

const advertiser = createAdvertiser({
  isWanted: () => wanted.lanAdvertise,
  options: () => ({ name: INSTANCE_NAME, port: PORT }),
  log: (message) => console.log(`[discovery] ${message}`),
});

/** What the LAN offers to be added on the MCP servers page. */
export const lanServers = createLanServers({
  isWanted: () => wanted.lanDiscovery,
  ownInstanceName: INSTANCE_NAME,
  servers: () =>
    db
      .select({ slug: mcpServers.slug, transport: mcpServers.transport, url: mcpServers.url })
      .from(mcpServers),
  log: console.log,
  watch: (handlers) => watchServers(handlers),
});

/**
 * Reads both switches and starts or stops each half to match. Call after `listen`, so a host that
 * finds the announcement can already read the catalog.
 */
export async function sync(): Promise<void> {
  const [row] = await db
    .select({ lanAdvertise: settings.lanAdvertise, lanDiscovery: settings.lanDiscovery })
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID))
    .limit(1);
  Object.assign(wanted, row);
  await Promise.all([advertiser.sync(), lanServers.sync()]);
}

let pending: ReturnType<typeof setTimeout>;

/**
 * A `sync` after the settings write that called for it has landed: called from the hook, it would
 * read the row as it stood before the write.
 */
export function syncSoon() {
  clearTimeout(pending);
  pending = setTimeout(() => void sync(), AFTER_COMMIT_MS);
}

/** Says goodbye on the network, so browsers drop this host at once, and stops watching. */
export async function close(): Promise<void> {
  clearTimeout(pending);
  await Promise.all([advertiser.close(), lanServers.close()]);
}
