import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { db } from "../db/client.ts";
import { type Settings, settings } from "../db/schema.ts";

export async function loadSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, "default")).limit(1);
  if (!row) throw new Error("settings row is missing — did ensureSchema() run?");
  return row;
}

/** The key from settings, else the environment. Local servers usually ignore it entirely. */
export const resolveApiKey = (config: Settings) =>
  config.apiKey || process.env.OPENAI_API_KEY || "";

/** Zero or less means no limit, which the SDK spells as `undefined`. */
export const timeoutMs = (config: Settings): number | undefined =>
  config.requestTimeoutSeconds > 0 ? config.requestTimeoutSeconds * 1000 : undefined;

/**
 * The client for the configured endpoint, made once and kept.
 *
 * The SDK holds its own connection pool, and a run makes a request per tool iteration on top of
 * whatever side tasks it asks for — building a fresh client for each of them throws that pool
 * away every time. Settings are editable at runtime, so everything the client is built from is
 * the key: change the endpoint, the key or the timeout and the next call gets a new client.
 *
 * The SDK insists on a non-empty key even where the server will not look at it.
 *
 * `maxRetries: 0` turns the SDK's own retrying off. Streaming is what this server does, and a
 * stream that has already emitted tokens must not be replayed from the top — the caller in
 * `agent.ts` knows whether anything has been produced yet and the SDK does not. The one-shot
 * calls in `side-task.ts` get their safety from `timeout`, which does apply to both.
 */
let current: { key: string; client: OpenAI } | undefined;

export function getClient(config: Settings): OpenAI {
  const apiKey = resolveApiKey(config) || "task-server";
  const timeout = timeoutMs(config);
  // Stringified rather than joined on a separator: no character is impossible in a URL or a
  // key, and two different settings must never resolve to the same cached client.
  const key = JSON.stringify([config.baseUrl, apiKey, timeout]);
  if (current?.key !== key) {
    current = {
      key,
      client: new OpenAI({ baseURL: config.baseUrl, apiKey, timeout, maxRetries: 0 }),
    };
  }
  return current.client;
}

export async function listModels(): Promise<string[]> {
  const { data } = await getClient(await loadSettings()).models.list();
  return data.map((model) => model.id).sort((a, b) => a.localeCompare(b));
}
