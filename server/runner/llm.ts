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
 * The SDK insists on a non-empty key even where the server will not look at it.
 *
 * `maxRetries: 0` turns the SDK's own retrying off. Streaming is what this server does, and a
 * stream that has already emitted tokens must not be replayed from the top — the caller in
 * `agent.ts` knows whether anything has been produced yet and the SDK does not. The one-shot
 * calls in `side-task.ts` get their safety from `timeout`, which does apply to both.
 */
export const getClient = (config: Settings) =>
  new OpenAI({
    baseURL: config.baseUrl,
    apiKey: resolveApiKey(config) || "task-server",
    timeout: timeoutMs(config),
    maxRetries: 0,
  });

/** Zero or less means no limit, which the SDK spells as `undefined`. */
export const timeoutMs = (config: Settings): number | undefined =>
  config.requestTimeoutSeconds > 0 ? config.requestTimeoutSeconds * 1000 : undefined;

export async function listModels(): Promise<string[]> {
  const { data } = await getClient(await loadSettings()).models.list();
  return data.map((model) => model.id).sort((a, b) => a.localeCompare(b));
}
