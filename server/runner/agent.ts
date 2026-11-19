import {
  type AgentLoopHooks,
  contextLimitFor,
  preselect,
  type RunEventInput,
  RunEventKind,
  type RunMetrics,
  runAgentLoop,
  withContext,
} from "@cubicecho/agent-core";
import type { Settings } from "../db/schema.ts";
import { mcp } from "./mcp.ts";
import { pruneWhenFilling } from "./pruning.ts";
import { isRemoteAgent, NO_SERVERS } from "./remote-agent.ts";

/** What a step produced and what it cost — and, summed over its steps, what a whole flow did. */
export interface AgentResult {
  output: string;
  toolCalls: { name: string; ok: boolean }[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * The run on the ai-router that answered, where the step ran on one of its agents: the id its
   * `GET /runs/<id>` reads, and the only lasting record of what the agent did inside the step.
   */
  remoteRunId?: string;
  /** Whether the step ran on an ai-router agent. See `remote-agent.ts`. */
  remote?: boolean;
}

export interface AgentOptions {
  config: Settings;
  model: string;
  systemPrompt: string;
  prompt: string;
  /**
   * The flow step this is, by name. The loop opens and closes the step with `exchange` and
   * `exchange-end` under it, which are the boundaries a watcher groups a run by.
   */
  exchange?: string;
  /**
   * What the MCP servers' hooks added for this step — `<context>` blocks from `hooks.ts`. Put in
   * front of the prompt in the request only: tool preselection reads the prompt as written.
   */
  context?: string;
  /**
   * Which MCP servers this run may reach, by id, from its task's agent profile. Undefined —
   * which is every task on a server with no profiles — is every connected server, as before.
   */
  servers?: ReadonlySet<string>;
  signal?: AbortSignal;
  /** Called as the run happens, for whoever is watching it. See `@cubicecho/agent-core`. */
  onEvent?: (event: RunEventInput) => void;
  /**
   * Handed the loop's own metrics once the step has its answer, with the window it was served.
   * The run's metrics are summed from its events, which carry everything but what `load_tools`
   * resolved to and which window each step's model had — this is how those two get out.
   */
  onMetrics?: (metrics: RunMetrics, contextLength: number) => void;
  /** The MCP servers' `beforeCompact` hooks for this step, from `HookSession.compaction`. */
  hooks?: AgentLoopHooks;
}

/**
 * How many more requests an answer cut off at `maxTokens` is given to finish. Half an answer
 * stored as the answer reads exactly like a whole one, so a step is worth the extra request —
 * and two is enough to finish a reply that ran a little long without letting a model that never
 * stops spend a run's budget on the ceiling.
 */
const MAX_CONTINUATIONS = 2;

/**
 * Runs one task to completion: send the prompt, execute whatever MCP tools the model asks
 * for, loop until it stops asking, and return its final reply.
 *
 * The loop is agent-core's `runAgentLoop`; what is here is which model, which MCP servers, and
 * what a watcher is told. A run keeps no history, so nothing is learned between runs: whatever
 * the model loads, it loads again next time.
 */
export async function runAgent({
  config,
  model,
  systemPrompt,
  prompt,
  exchange,
  context = "",
  servers,
  signal,
  onEvent,
  onMetrics,
  hooks,
}: AgentOptions): Promise<AgentResult> {
  if (!model) {
    throw new Error("No model selected — pick one in Settings.");
  }

  // Carries what was given up on, what is being waited out and what was cut short in one voice,
  // so a watcher and the log are told about a downgrade and a retry alike.
  const notice = (text: string) => {
    console.warn(`[agent] ${text}`);
    onEvent?.({ kind: RunEventKind.Notice, text });
  };

  // An agent behind the endpoint runs its own loop, and the step is a thin client of it: its
  // window, compaction, pruning and tool loading are the agent's, and it reaches only the servers
  // it was pointed at. See `remote-agent.ts`.
  const remote = await isRemoteAgent(config, model, signal);
  const scope = remote ? (servers ?? NO_SERVERS) : servers;

  const catalog = remote ? [] : mcp.catalog(scope);

  // Chosen here rather than by the loop, for two things the loop's own preselection does not do:
  // it reads the prompt as written, before the hooks' context is put in front of it, and the
  // watcher is told what was picked (agent-core#150). Guessing wrong is cheap — an unused definition costs a few
  // hundred tokens for one run, and the model can still load what it actually wanted. Never on an
  // agent: its endpoint lists agents, and the tool-select model is not one of them.
  const preselected =
    !remote && config.toolDiscovery === "ondemand"
      ? await preselect(config, config.toolSelectModel || model, catalog, prompt, {
          signal,
          onNotice: notice,
        })
      : [];
  if (preselected.length) {
    notice(`tools picked before the run: ${preselected.join(", ")}`);
  }

  // What the model will read, so a request that cannot fit is refused here with its size rather
  // than by the endpoint a round trip later. Zero where the endpoint does not say, or not within
  // agent-core's own bound on the lookup, which guards nothing; a stop ends the wait with the run.
  // An agent's window is its own business, and the guard is set aside on one anyway.
  const contextLength = remote ? 0 : await contextLimitFor({ ...config, model }, 0, { signal });

  /** The agent's own calls, as its progress tells them, by id, in the order they were made. */
  const agentCalls = new Map<string, { name: string; ok?: boolean }>();

  const { turn, toolCalls, usage, metrics, remoteRunId } = await runAgentLoop({
    config: remote
      ? {
          // The sampling is sent: the profile and the settings row are where an operator says
          // what a step should run at, and an agent's override policy is the router's to set.
          ...config,
          model,
          remoteAgent: true,
          toolDiscovery: "eager",
          firstTokenSeconds: config.requestTimeoutSeconds,
        }
      : {
          // A step may run on a model other than the settings row's. The first token gets the
          // same patience as every one after it, where the loop would otherwise wait five times
          // as long.
          ...config,
          model,
          contextLength,
          firstTokenSeconds: config.requestTimeoutSeconds,
          // On the run's own endpoint, and only when a model is named: the loop has no fallback
          // to the main model, so an empty column leaves `compact` with nothing to summarise with.
          ...(config.compactionModel
            ? { tasks: { compaction: { model: config.compactionModel, endpoint: config } } }
            : {}),
        },
    system: systemPrompt,
    // The context goes on the step's one question and stays there for the step's whole loop: a
    // run keeps no transcript, so there is no stored message it could leak into. What is said
    // above it is set once in `hooks.ts`, which is the only place a context comes from.
    messages: withContext([{ role: "user", content: prompt }], 0, context),
    tools: mcp.tools({ servers: scope }),
    catalog,
    preselected,
    // Both are decisions, not defaults nobody looked at. Sorted by name, a tool loaded on demand
    // lands mid-array and moves every definition after it, where unsorted it is appended and the
    // prefix an endpoint cached still matches. And two identical calls in one step are two
    // calls: a counter or a "next page" is meant to answer differently the second time.
    toolOrder: false,
    dedupeToolCalls: false,
    // The operator's call, since only they know whether their tools write: results still go back
    // in the order the model asked, but two writes run together land in the order they finish.
    parallel: config.toolExecution === "parallel",
    ...(remote
      ? {}
      : {
          maxContinuations: MAX_CONTINUATIONS,
          // Off unless a compaction model is set, as in min-agent. Also inert where the endpoint
          // did not report a window, since there is nothing to plan three quarters of.
          compact: Boolean(config.compactionModel),
          // Only ever `beforeCompact`: see `compaction` in `hooks.ts`.
          ...(hooks ? { hooks } : {}),
          // Needs no model, so it is on wherever the window is known. It runs ahead of the fold,
          // which then plans from what is left: a prune that brings the run back under the line
          // spares it the summary's round trip.
          beforeTurn: (messages, _turn, window) => {
            const pruned = pruneWhenFilling(messages, window);
            if (pruned) {
              notice(
                `cleared ${pruned.cleared} old tool result${pruned.cleared === 1 ? "" : "s"} ` +
                  `(~${pruned.tokens} tokens) as the window filled`,
              );
            }
            return pruned?.messages;
          },
        }),
    dispatch: (call) => mcp.call(call.name, call.args, { servers: scope }),
    ...(exchange ? { exchange } : {}),
    signal,
    onEvent: (event) => {
      if (event.kind === RunEventKind.Notice) {
        console.warn(`[agent] ${event.text}`);
      }
      // An agent's progress carries its own `seq`, and tells every call it made — its own and the
      // ones it handed back — which the step's row would otherwise only have the second half of.
      if ("seq" in event && event.id) {
        if (event.kind === RunEventKind.ToolCall && !agentCalls.has(event.id)) {
          agentCalls.set(event.id, { name: event.name ?? "" });
        }
        const call = agentCalls.get(event.id);
        if (event.kind === RunEventKind.ToolResult && call) {
          call.ok = event.ok !== false;
        }
      }
      onEvent?.(event);
    },
  });

  onMetrics?.(metrics, contextLength);

  // On an agent, its progress is the whole story where there is any; a call it handed back that
  // the progress never told is added after, so nothing the step ran goes unrecorded.
  const told = [...agentCalls].map(([id, { name, ok }]) => ({ id, name, ok: ok ?? false }));
  const known = new Set(told.map((call) => call.id));
  const calls = [...told, ...toolCalls.filter((call) => !call.id || !known.has(call.id))];

  return {
    output: turn.content,
    // `load_tools` is recorded alongside the real calls: the run history is what the task
    // actually did, and "spent three steps loading tools" is part of that.
    toolCalls: calls.map(({ name, ok }) => ({ name, ok })),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    ...(remote ? { remote, ...(remoteRunId ? { remoteRunId } : {}) } : {}),
  };
}
