import {
  type Endpoint,
  endpointKey,
  NO_KEY,
  normalizeBaseUrl,
  PROGRESS_FIELD,
} from "@cubicecho/agent-core";

/**
 * Whether a model is a remote agent: one that runs a whole agent loop of its own behind the chat
 * completions API, as ai-router serves one per agent name, and hands the app's own tools back to
 * it. A step on one runs agent-core's loop as a thin client (`remoteAgent: true`), since the tools
 * a loop keeps for itself (`load_tools`) are names such a server refuses to take as the app's, and
 * its compaction, pruning and tool loading are the server's to do.
 *
 * ai-router says so on its model listing, `"agent_core": { "kind": "agent" }` on the entry, and
 * agent-core's `listModels` keeps only an entry's id and window, so the listing is read here.
 * Copied from min-agent's `server/remote-agent.ts` until agent-core reads the mark itself
 * ([agent-core#238](https://github.com/cubicecho/agent-core/issues/238)); delete this file then.
 */

/** What an ai-router model entry carries to say it is an agent. */
const AGENT_KIND = "agent";

/**
 * How long a listing is waited for. It is on the path of a step's first request, and a router that
 * will not say what it serves in this long is not going to run the step any sooner.
 */
const LISTING_TIMEOUT_MS = 10_000;

/**
 * What is known, per model server, key and model. A model does not stop being an agent while the
 * process runs, so an answer is kept; a listing that could not be read is not an answer, and is
 * asked again on the next step. The key is part of it because a router can list one set of agents
 * to one workspace's key and another to the next.
 */
const known = new Map<string, boolean>();

/**
 * A scope of no servers, which the pool reads as none where `undefined` is all of them: what a
 * step on an agent reaches when nothing narrowed it to more.
 */
export const NO_SERVERS: ReadonlySet<string> = new Set();

/** Forgets what is known, so one test's endpoint is not the next one's. */
export const resetRemoteAgents = () => known.clear();

/** The part of a config this asks with — a settings row will do. */
type Server = Pick<Endpoint, "baseUrl" | "apiKey" | "fetch">;

/**
 * Whether `model` on `server` is a remote agent.
 *
 * @param server The model server, as the step reaches it.
 * @param model The model the step runs on.
 * @param signal The run's, so a stop ends the wait with it.
 * @returns `true` where the listing marks the model an agent; `false` where it does not, or where
 * there is no listing to read.
 */
export async function isRemoteAgent(
  server: Server,
  model: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!server.baseUrl || !model) {
    return false;
  }
  const key = `${endpointKey(server)}\u0000${model}`;
  const kept = known.get(key);
  if (kept !== undefined) {
    return kept;
  }
  const listed = await listing(server, signal);
  if (listed === undefined) {
    return false;
  }
  const entry = listed.find((each) => each.id === model);
  const isAgent = entry?.[PROGRESS_FIELD]?.kind === AGENT_KIND;
  known.set(key, isAgent);
  return isAgent;
}

/**
 * The models `server` lists as agents, for a picker to mark. Reading the listing answers every
 * model on it, so what it says is kept for the steps that ask after it.
 *
 * @returns The agents' ids; none where the listing could not be read.
 */
export async function listedAgents(server: Server, signal?: AbortSignal): Promise<string[]> {
  if (!server.baseUrl) {
    return [];
  }
  const listed = (await listing(server, signal)) ?? [];
  const agents: string[] = [];
  for (const entry of listed) {
    if (typeof entry.id !== "string") {
      continue;
    }
    const isAgent = entry[PROGRESS_FIELD]?.kind === AGENT_KIND;
    known.set(`${endpointKey(server)}\u0000${entry.id}`, isAgent);
    if (isAgent) {
      agents.push(entry.id);
    }
  }
  return agents;
}

interface ListedModel {
  id?: unknown;
  [PROGRESS_FIELD]?: { kind?: unknown };
}

/** The server's `/models` entries, or `undefined` where they could not be read. */
async function listing(server: Server, signal?: AbortSignal): Promise<ListedModel[] | undefined> {
  const baseUrl = normalizeBaseUrl(server.baseUrl) ?? server.baseUrl.replace(/\/+$/, "");
  const send = server.fetch ?? fetch;
  const headers: Record<string, string> =
    server.apiKey && server.apiKey !== NO_KEY ? { Authorization: `Bearer ${server.apiKey}` } : {};
  try {
    const waits = [AbortSignal.timeout(LISTING_TIMEOUT_MS), ...(signal ? [signal] : [])];
    const response = await send(`${baseUrl}/models`, { headers, signal: AbortSignal.any(waits) });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { data?: unknown };
    return Array.isArray(body.data) ? (body.data as ListedModel[]) : undefined;
  } catch {
    return undefined;
  }
}
