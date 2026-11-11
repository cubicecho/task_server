import {
  type AgentSpec,
  defineSpecColumns,
  ReasoningReplay,
  resolveAgentSpec,
  resolveApiKey,
} from "@cubicecho/agent-core";
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

/**
 * Where a spec carries what this server has a column for and the format has no field for. A
 * spec's `extensions` are a host's own, keyed by reverse domain, and are kept by every reader —
 * so `toolExecution` and `serverInstructions` survive an export and an import here, where an
 * unknown key under `tools` would be dropped by the parser on the way back in.
 */
export const SPEC_EXTENSION = "com.cubicecho.task-server";

/** The settings column's spelling of a replay policy, which is the profile column's less `inherit`. */
export type ReplayColumn = Settings["reasoningReplay"];

/**
 * A replay column as agent-core spells it. Only `tool_loop` differs: a GraphQL enum value cannot
 * hold a hyphen, so the column cannot store agent-core's word for it.
 */
export const replayPolicy = (column: ReplayColumn): ReasoningReplay =>
  column === "tool_loop" ? ReasoningReplay.ToolLoop : column;

/** The other way, for what comes back from the resolver and in from a spec. */
export const replayColumn = (policy: ReasoningReplay): ReplayColumn =>
  policy === ReasoningReplay.ToolLoop ? "tool_loop" : policy;

/** `""` is "ask settings" for a string column, and so is one that is only whitespace. */
const str = (value: string) => value.trim() || undefined;

/**
 * `-1` is "ask settings" for a number column, and so is any other negative — zero is meant.
 * Zero retries, zero seconds of patience and zero tokens are all real answers, so the sentinel
 * has to be a value none of these columns can legitimately hold.
 */
const num = (value: number) => (value < 0 ? undefined : value);

/**
 * The settings row as the bottom layer: no column has a marker, so every one is an answer,
 * blank ones included. An empty tool-selection model is "use the run's own", and has to reach
 * the resolver as that rather than as nothing said.
 *
 * `toolExecution` and `serverInstructions` are not in it: a spec has no field for them, and
 * `extensions` merge whole by key, so `resolveConfig` lays those two over by hand.
 */
const SETTINGS_COLUMNS = defineSpecColumns<Settings>({
  baseUrl: { path: "endpoint.baseUrl" },
  requestTimeoutSeconds: { path: "endpoint.requestTimeoutSeconds" },
  model: { path: "model.model" },
  maxTokens: { path: "model.maxTokens" },
  temperature: { path: "model.temperature" },
  reasoningReplay: { path: "model.reasoningReplay", toSpec: replayPolicy },
  systemPrompt: { path: `prompt.${SYSTEM}` },
  toolDiscovery: { path: "tools.discovery" },
  maxToolIterations: { path: "tools.maxIterations" },
  maxRetries: { path: "retry.maxRetries" },
  toolSelectModel: { path: "tasks.toolSelect.model" },
  compactionModel: { path: "tasks.compaction.model" },
});

/**
 * A profile as the layer above it. A column at its inherit value is a field the layer does not
 * have, which is the only spelling of "inherit" the resolver knows; a blank prompt would replace
 * the server's prompt with nothing, where a missing part leaves it alone. The marker is one value
 * per column, and `str` and `num` widen it to the range each column treats as inherit.
 *
 * `mcpServerIds` is not in it: a spec has no field for this server's row ids, and
 * `resolveServers` answers it from the row.
 */
const AGENT_COLUMNS = defineSpecColumns<Agent>({
  baseUrl: { path: "endpoint.baseUrl", inherit: "", toSpec: str },
  requestTimeoutSeconds: { path: "endpoint.requestTimeoutSeconds", inherit: -1, toSpec: num },
  model: { path: "model.model", inherit: "", toSpec: str },
  maxTokens: { path: "model.maxTokens", inherit: -1, toSpec: num },
  temperature: { path: "model.temperature", inherit: -1, toSpec: num },
  reasoningReplay: {
    path: "model.reasoningReplay",
    inherit: "inherit",
    // Never handed the marker, but its type is the column's, which holds it.
    toSpec: (value) => (value === "inherit" ? undefined : replayPolicy(value)),
  },
  systemPrompt: { path: `prompt.${SYSTEM}`, inherit: "", toSpec: str },
  toolDiscovery: { path: "tools.discovery", inherit: "inherit" },
  maxToolIterations: { path: "tools.maxIterations", inherit: -1, toSpec: num },
  maxRetries: { path: "retry.maxRetries", inherit: -1, toSpec: num },
  toolSelectModel: { path: "tasks.toolSelect.model", inherit: "", toSpec: str },
  compactionModel: { path: "tasks.compaction.model", inherit: "", toSpec: str },
  toolExecution: { path: ["extensions", SPEC_EXTENSION, "toolExecution"], inherit: "inherit" },
  serverInstructions: {
    path: ["extensions", SPEC_EXTENSION, "serverInstructions"],
    inherit: "inherit",
    toSpec: (value) => value === "on",
  },
});

/**
 * A profile as a spec layer: what it says, and nothing it inherits. Exported because `agentSpec`
 * hands out this same layer with its slugs put back, and a second projection would be a second
 * opinion on "inherit".
 */
export const agentLayer = (agent: Agent): AgentSpec => AGENT_COLUMNS.toLayer(agent);

/**
 * The settings row as this agent would have it.
 *
 * The merge is agent-core's `resolveAgentSpec` over two spec layers, and only the columns come
 * back. The key is laid over beside it, since a spec carries no credential, and by agent-core's
 * `resolveApiKey`: an agent naming another `baseUrl` uses its own key or none, never the
 * operator's or `$OPENAI_API_KEY`, because a credential issued for one endpoint has no business
 * being posted to another. What counts as another is `normalizeBaseUrl`'s answer — a trailing
 * slash, the host's case or a default port is the same server, and the key goes to it either way.
 */
export function resolveConfig(settings: Settings, agent?: Agent | null): Settings {
  if (!agent) {
    return settings;
  }

  const merged = resolveAgentSpec([SETTINGS_COLUMNS.toLayer(settings), agentLayer(agent)]);

  return {
    ...settings,
    baseUrl: merged.baseUrl,
    // No environment: `loadSettings` has already folded `$OPENAI_API_KEY` into the row, and a
    // second reading of it here would be a second place that decides what the key is.
    apiKey: resolveApiKey(agent, settings, {}),
    model: merged.model,
    systemPrompt: merged.systemPrompt,
    maxTokens: merged.maxTokens,
    temperature: merged.temperature,
    // Optional in a spec, where the settings column always holds one.
    reasoningReplay: merged.reasoningReplay
      ? replayColumn(merged.reasoningReplay)
      : settings.reasoningReplay,
    maxToolIterations: merged.maxToolIterations,
    // Wider in a spec than in either row: neither layer can say `proxy`, and the timeout is
    // optional there where the settings column always holds one.
    toolDiscovery: merged.toolDiscovery === "proxy" ? settings.toolDiscovery : merged.toolDiscovery,
    toolSelectModel: merged.toolSelectModel,
    // Neither is the resolver's: a spec has no field for them, and `extensions` merge whole by
    // key, so the laying-over is done here on the columns rather than on the extension objects.
    toolExecution: agent.toolExecution === "inherit" ? settings.toolExecution : agent.toolExecution,
    serverInstructions:
      agent.serverInstructions === "inherit"
        ? settings.serverInstructions
        : agent.serverInstructions === "on",
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
