import { listModels as listEndpointModels } from "@cubicecho/agent-core";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { type Settings, settings } from "../db/schema.ts";

/**
 * What this server is configured to talk to, and what the endpoint offers.
 *
 * The client cache, the timeout arithmetic and the retry rules that used to live here are
 * `@cubicecho/agent-core`'s now. What is left is the two things that are this server's: the
 * settings row it reads them from, and the model list its UI draws.
 */

/**
 * The settings row, with the key the environment supplies folded in.
 *
 * Resolved here rather than at the call that uses it, because agent-core takes a config and
 * asks no questions of it — a fallback applied in one caller and not another is a run whose
 * side tasks authenticate and whose turns do not. `$OPENAI_API_KEY` is a way of *supplying* the
 * setting, so the row that comes out of here already says what the key is.
 *
 * `apiKey` is excluded from the generated GraphQL types (see `schema.ts`), so this row is never
 * something a response is built from.
 */
export async function loadSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, "default")).limit(1);
  if (!row) throw new Error("settings row is missing — did ensureSchema() run?");
  return { ...row, apiKey: row.apiKey || process.env.OPENAI_API_KEY || "" };
}

/**
 * The models an endpoint offers, by name.
 *
 * Pass a resolved config to ask an agent profile's endpoint instead of the server's own. The
 * context length agent-core reports alongside each name is dropped: nothing here sizes a window
 * from it, and the picker this feeds shows names.
 */
export async function listModels(config?: Settings): Promise<string[]> {
  const models = await listEndpointModels(config ?? (await loadSettings()));
  return models.map((model) => model.id);
}
