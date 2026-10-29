import { AGENT_SPEC, type AgentSpec, NO_KEY, resolveAgentSpec } from "@cubicecho/agent-core";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { type Agent, agents, type Settings, type Task } from "../db/schema.ts";
import { loadSettings } from "./llm.ts";

/**
 * What a run is configured with: the settings row, with a task's agent laid over it.
 *
 * An agent profile does not add a second thing to read. It produces a different `Settings` for
 * that run, which is why per-task endpoints cost the agent loop no branch. A task with no agent
 * gets the settings row unchanged.
 */
export interface RunConfig {
  config: Settings;
  /**
   * Which MCP servers this run may reach, by id. `undefined` is every enabled server — the
   * pool's own answer, and what every run got before profiles existed.
   */
  servers?: ReadonlySet<string>;
}

/** The one id both rows write their system prompt under, so a profile's replaces the server's. */
const SYSTEM = "system";

/** `""` is "ask settings" for a string column, which a layer says by leaving the field out. */
const str = (value: string) => value.trim() || undefined;

/**
 * `-1` is "ask settings" for a number column, and anything else is meant — zero included.
 * Zero retries, zero seconds of patience and zero tokens are all real answers, so the sentinel
 * has to be a value none of these columns can legitimately hold.
 */
const num = (value: number) => (value < 0 ? undefined : value);

/**
 * The settings row as the bottom layer: every column is an answer, blank ones included. An
 * empty tool-selection model is "use the run's own", and has to reach the resolver as that
 * rather than as nothing said.
 */
const settingsLayer = (settings: Settings): AgentSpec => ({
  spec: AGENT_SPEC,
  endpoint: {
    baseUrl: settings.baseUrl,
    requestTimeoutSeconds: settings.requestTimeoutSeconds,
  },
  model: {
    model: settings.model,
    maxTokens: settings.maxTokens,
    temperature: settings.temperature,
  },
  prompt: [{ id: SYSTEM, text: settings.systemPrompt }],
  tools: { discovery: settings.toolDiscovery, maxIterations: settings.maxToolIterations },
  retry: { maxRetries: settings.maxRetries },
  tasks: {
    toolSelect: { model: settings.toolSelectModel },
    compaction: { model: settings.compactionModel },
  },
});

/**
 * A profile as the layer above it. A column at its inherit value is a field the layer does not
 * have, which is the only spelling of "inherit" the resolver knows; an empty `prompt` part would
 * replace the server's prompt with nothing, where a missing one leaves it alone.
 *
 * `mcpServerIds` is not in it: a spec has no field for this server's row ids, and
 * `resolveServers` answers it from the row. Exported because `agentSpec` hands out this same
 * layer with its slugs put back, and a second projection would be a second opinion on "inherit".
 */
export const agentLayer = (agent: Agent): AgentSpec => {
  const prompt = str(agent.systemPrompt);
  const toolSelect = str(agent.toolSelectModel);
  const compaction = str(agent.compactionModel);
  return {
    spec: AGENT_SPEC,
    endpoint: {
      baseUrl: str(agent.baseUrl),
      requestTimeoutSeconds: num(agent.requestTimeoutSeconds),
    },
    model: {
      model: str(agent.model),
      maxTokens: num(agent.maxTokens),
      temperature: num(agent.temperature),
    },
    ...(prompt ? { prompt: [{ id: SYSTEM, text: prompt }] } : {}),
    tools: {
      discovery: agent.toolDiscovery === "inherit" ? undefined : agent.toolDiscovery,
      maxIterations: num(agent.maxToolIterations),
    },
    retry: { maxRetries: num(agent.maxRetries) },
    ...(toolSelect || compaction
      ? {
          tasks: {
            ...(toolSelect ? { toolSelect: { model: toolSelect } } : {}),
            ...(compaction ? { compaction: { model: compaction } } : {}),
          },
        }
      : {}),
  };
};

/**
 * The settings row as this agent would have it.
 *
 * The merge is agent-core's `resolveAgentSpec` over two spec layers, and only the columns come
 * back. The key stays here, since a spec carries no credential: an agent naming its own
 * `baseUrl` uses its own key or none, never the operator's or `$OPENAI_API_KEY`, because a
 * credential issued for one endpoint has no business being posted to another. agent-core's
 * `resolveApiKey` is not used: it treats a trailing slash as the same endpoint, which errs
 * toward sending the key.
 */
export function resolveConfig(settings: Settings, agent?: Agent | null): Settings {
  if (!agent) {
    return settings;
  }

  const baseUrl = agent.baseUrl.trim();
  const elsewhere = baseUrl !== "" && baseUrl !== settings.baseUrl;
  const merged = resolveAgentSpec([settingsLayer(settings), agentLayer(agent)]);

  return {
    ...settings,
    baseUrl: merged.baseUrl,
    apiKey: agent.apiKey || (elsewhere ? NO_KEY : settings.apiKey),
    model: merged.model,
    systemPrompt: merged.systemPrompt,
    maxTokens: merged.maxTokens,
    temperature: merged.temperature,
    maxToolIterations: merged.maxToolIterations,
    // Wider in a spec than in either row: neither layer can say `proxy`, and the timeout is
    // optional there where the settings column always holds one.
    toolDiscovery: merged.toolDiscovery === "proxy" ? settings.toolDiscovery : merged.toolDiscovery,
    toolSelectModel: merged.toolSelectModel,
    // The resolver leaves out a task whose model is blank, which is the column's own "off".
    compactionModel: merged.tasks.compaction?.model ?? "",
    requestTimeoutSeconds: merged.requestTimeoutSeconds ?? settings.requestTimeoutSeconds,
    maxRetries: merged.maxRetries,
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
  if (!task.agentId) {
    return { config: settings };
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, task.agentId)).limit(1);
  return { config: resolveConfig(settings, agent), servers: resolveServers(agent) };
}
