import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { type Agent, agents, type Settings, type Task } from "../db/schema.ts";
import { loadSettings, NO_KEY } from "./llm.ts";

/**
 * What a run is configured with: the settings row, with a task's agent laid over it.
 *
 * The runner reads one `Settings` object and always has — endpoint, key, model, the ceilings,
 * how tools are discovered. An agent profile does not add a second thing to read; it produces a
 * different `Settings` for that run and nothing downstream knows the difference. That is the
 * whole trick, and it is why per-task endpoints cost the agent loop no branch.
 *
 * A task with no agent gets the settings row unchanged, which is every task on a server where
 * nobody has made an agent.
 */
export interface RunConfig {
  config: Settings;
  /**
   * Which MCP servers this run may reach, by id. `undefined` is every enabled server — the
   * pool's own answer, and what every run got before profiles existed.
   */
  servers?: ReadonlySet<string>;
}

/** `""` is "ask settings" for a string column. */
const str = (override: string, fallback: string) => override.trim() || fallback;

/**
 * `-1` is "ask settings" for a number column, and anything else is meant — zero included.
 * Zero retries, zero seconds of patience and zero tokens are all real answers, so the sentinel
 * has to be a value none of these columns can legitimately hold.
 */
const num = (override: number, fallback: number) => (override < 0 ? fallback : override);

/**
 * The settings row as this agent would have it.
 *
 * The one column that is not a plain override is the key. An agent that names its own `baseUrl`
 * does **not** inherit the operator's key or `$OPENAI_API_KEY`: a credential issued for one
 * endpoint has no business being posted to another, and "I pointed a task at a friend's server
 * and it sent my OpenAI key" is not a mistake worth being able to make. Such an agent uses its
 * own key or none at all, which is what a local server wants anyway. An agent on the *same*
 * endpoint inherits the key as it inherits everything else.
 */
export function resolveConfig(settings: Settings, agent?: Agent | null): Settings {
  if (!agent) return settings;

  const baseUrl = agent.baseUrl.trim();
  const elsewhere = baseUrl !== "" && baseUrl !== settings.baseUrl;

  return {
    ...settings,
    baseUrl: baseUrl || settings.baseUrl,
    apiKey: agent.apiKey || (elsewhere ? NO_KEY : settings.apiKey),
    model: str(agent.model, settings.model),
    systemPrompt: str(agent.systemPrompt, settings.systemPrompt),
    maxTokens: num(agent.maxTokens, settings.maxTokens),
    temperature: num(agent.temperature, settings.temperature),
    maxToolIterations: num(agent.maxToolIterations, settings.maxToolIterations),
    toolDiscovery: agent.toolDiscovery === "inherit" ? settings.toolDiscovery : agent.toolDiscovery,
    toolSelectModel: str(agent.toolSelectModel, settings.toolSelectModel),
    requestTimeoutSeconds: num(agent.requestTimeoutSeconds, settings.requestTimeoutSeconds),
    maxRetries: num(agent.maxRetries, settings.maxRetries),
  };
}

/** An empty list is not a scope. It is a profile that has never been narrowed. */
export const resolveServers = (agent?: Agent | null): ReadonlySet<string> | undefined =>
  agent?.mcpServerIds?.length ? new Set(agent.mcpServerIds) : undefined;

/**
 * Everything the runner needs to run this task, read at the moment the run starts.
 *
 * Read now rather than held: settings and profiles are both editable while the server is up,
 * and a run should use what they say when it begins. A task naming an agent that has since been
 * deleted is a null `agentId` by then — the foreign key sees to that — so this cannot fail to
 * find one.
 */
export async function configForTask(task: Task): Promise<RunConfig> {
  const settings = await loadSettings();
  if (!task.agentId) return { config: settings };

  const [agent] = await db.select().from(agents).where(eq(agents.id, task.agentId)).limit(1);
  return { config: resolveConfig(settings, agent), servers: resolveServers(agent) };
}
