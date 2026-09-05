import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { db } from "../db/client.ts";
import { type Settings, settings } from "../db/schema.ts";

export async function loadSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, "default")).limit(1);
  if (!row) throw new Error("settings row is missing — did ensureSchema() run?");
  return row;
}

/**
 * What the SDK is handed where the endpoint will not look at it: it insists on a non-empty key,
 * and a local server ignores whatever it is given. `profile.ts` also uses it to say "this agent
 * has an endpoint of its own and no key for it" — which must not fall through to the
 * environment, hence a value rather than an empty string.
 */
export const NO_KEY = "task-server";

/** The key from settings, else the environment. Local servers usually ignore it entirely. */
export const resolveApiKey = (config: Settings) =>
  config.apiKey || process.env.OPENAI_API_KEY || "";

/** Zero or less means no limit, which the SDK spells as `undefined`. */
export const timeoutMs = (config: Settings): number | undefined =>
  config.requestTimeoutSeconds > 0 ? config.requestTimeoutSeconds * 1000 : undefined;

/**
 * The client for an endpoint, made once and kept.
 *
 * The SDK holds its own connection pool, and a run makes a request per tool iteration on top of
 * whatever side tasks it asks for — building a fresh client for each of them throws that pool
 * away every time. Settings are editable at runtime, so everything the client is built from is
 * the cache key: change the endpoint, the key or the timeout and the next call gets a new
 * client.
 *
 * Several at once rather than one, because an agent profile can name an endpoint of its own:
 * two tasks running side by side on different endpoints would otherwise evict each other's
 * client on every request. The keys are built from rows, so this holds one entry per distinct
 * endpoint/key/timeout across the settings row and the agents table — a handful, and it shrinks
 * to the single entry this map used to be on a server with no agents.
 *
 * The SDK insists on a non-empty key even where the server will not look at it.
 *
 * `maxRetries: 0` turns the SDK's own retrying off. Streaming is what this server does, and a
 * stream that has already emitted tokens must not be replayed from the top — the caller in
 * `agent.ts` knows whether anything has been produced yet and the SDK does not. The one-shot
 * calls in `side-task.ts` get their safety from `timeout`, which does apply to both.
 */
const clients = new Map<string, OpenAI>();

export function getClient(config: Settings): OpenAI {
  const apiKey = resolveApiKey(config) || NO_KEY;
  const timeout = timeoutMs(config);
  // Stringified rather than joined on a separator: no character is impossible in a URL or a
  // key, and two different settings must never resolve to the same cached client.
  const key = JSON.stringify([config.baseUrl, apiKey, timeout]);
  const existing = clients.get(key);
  if (existing) return existing;

  const client = new OpenAI({ baseURL: config.baseUrl, apiKey, timeout, maxRetries: 0 });
  clients.set(key, client);
  return client;
}

/** Pass a resolved config to ask an agent profile's endpoint instead of the server's own. */
export async function listModels(config?: Settings): Promise<string[]> {
  const { data } = await getClient(config ?? (await loadSettings())).models.list();
  return data.map((model) => model.id).sort((a, b) => a.localeCompare(b));
}
