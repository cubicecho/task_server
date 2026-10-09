import { preselect, type RunEventInput, runAgentLoop, withContext } from "@cubicecho/agent-core";
import type { Settings } from "../db/schema.ts";
import { HOOK_PREFACE } from "./hooks.ts";
import { mcp } from "./mcp.ts";

/** What a step produced and what it cost — and, summed over its steps, what a whole flow did. */
export interface AgentResult {
  output: string;
  toolCalls: { name: string; ok: boolean }[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentOptions {
  config: Settings;
  model: string;
  systemPrompt: string;
  prompt: string;
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
}

/**
 * Runs one task to completion: send the prompt, execute whatever MCP tools the model asks
 * for, loop until it stops asking, and return its final reply.
 *
 * The loop itself is agent-core's `runAgentLoop`. What is here is what is this server's: which
 * model, which MCP servers, and what a watcher is told.
 *
 * A run keeps no history — it starts from nothing every time, so the only state is the messages
 * built up inside this call. That also means nothing is learned between runs: whatever the model
 * loads, it loads again next time.
 */
export async function runAgent({
  config,
  model,
  systemPrompt,
  prompt,
  context = "",
  servers,
  signal,
  onEvent,
}: AgentOptions): Promise<AgentResult> {
  if (!model) throw new Error("No model selected — pick one in Settings.");

  // Carries what was given up on, what is being waited out and what was cut short in one voice,
  // so a watcher and the log are told about a downgrade and a retry alike.
  const notice = (text: string) => {
    console.warn(`[agent] ${text}`);
    onEvent?.({ kind: "notice", text });
  };

  const catalog = mcp.catalog(servers);

  // Chosen here rather than by the loop, for two things the loop's own preselection does not do:
  // it reads the prompt as written, before the hooks' context is put in front of it, and the
  // watcher is told what was picked (agent-core#150). Guessing wrong is cheap — an unused definition costs a few
  // hundred tokens for one run, and the model can still load what it actually wanted.
  const preselected =
    config.toolDiscovery === "ondemand"
      ? await preselect(config, config.toolSelectModel || model, catalog, prompt, {
          signal,
          onNotice: notice,
        })
      : [];
  if (preselected.length) notice(`tools picked before the run: ${preselected.join(", ")}`);

  const { turn, toolCalls, usage } = await runAgentLoop({
    // A step may run on a model other than the settings row's. The first token gets the same
    // patience as every one after it, where the loop would otherwise wait five times as long.
    config: { ...config, model, firstTokenSeconds: config.requestTimeoutSeconds },
    system: systemPrompt,
    // The context goes on the step's one question and stays there for the step's whole loop: a
    // run keeps no transcript, so there is no stored message it could leak into.
    messages: withContext([{ role: "user", content: prompt }], 0, context, HOOK_PREFACE),
    tools: mcp.tools({ servers }),
    catalog,
    preselected,
    // Both are decisions, not defaults nobody looked at. Sorted by name, a tool loaded on demand
    // lands mid-array and moves every definition after it, where unsorted it is appended and the
    // prefix an endpoint cached still matches. And two identical calls in one step are two
    // calls: a counter or a "next page" is meant to answer differently the second time.
    toolOrder: false,
    dedupeToolCalls: false,
    dispatch: (call) => mcp.call(call.name, call.args, { servers }),
    signal,
    onEvent: (event) => {
      if (event.kind === "notice") console.warn(`[agent] ${event.text}`);
      onEvent?.(event);
    },
  });

  return {
    output: turn.content,
    // `load_tools` is recorded alongside the real calls: the run history is what the task
    // actually did, and "spent three steps loading tools" is part of that.
    toolCalls: toolCalls.map(({ name, ok }) => ({ name, ok })),
    promptTokens: usage.prompt,
    completionTokens: usage.completion,
    totalTokens: usage.total,
  };
}
