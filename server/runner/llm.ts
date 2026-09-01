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

/**
 * The client for the configured endpoint, made once and kept.
 *
 * The SDK holds its own connection pool, and a run makes a request per tool iteration on top of
 * whatever side tasks it asks for — building a fresh client for each of them throws that pool
 * away every time. Settings are editable at runtime, so the endpoint and the key are the key:
 * change either and the next call gets a new client.
 *
 * The SDK insists on a non-empty key even where the server will not look at it.
 */
let current: { key: string; client: OpenAI } | undefined;

export function getClient(config: Settings): OpenAI {
  const apiKey = resolveApiKey(config) || "task-server";
  const key = `${config.baseUrl}\u0000${apiKey}`;
  if (current?.key !== key) {
    current = { key, client: new OpenAI({ baseURL: config.baseUrl, apiKey }) };
  }
  return current.client;
}

export async function listModels(): Promise<string[]> {
  const { data } = await getClient(await loadSettings()).models.list();
  return data.map((model) => model.id).sort((a, b) => a.localeCompare(b));
}
