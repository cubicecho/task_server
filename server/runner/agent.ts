import {
  type AgentLoopHooks,
  COMPACT_AT,
  contextLimitFor,
  PRUNE_SHARE,
  type RunArtifact,
  type RunEventInput,
  RunEventKind,
  runAgentLoop,
  type ToolCallRequest,
  withContext,
} from "@cubicecho/agent-core";
import { describeElicitation, type ElicitationNote } from "../../shared/elicitations.ts";
import type { Settings } from "../db/schema.ts";
import { declineUnattended } from "./elicitations.ts";
import { mcp } from "./mcp.ts";
import { replayPolicy } from "./profile.ts";

/** What a step produced and what it cost — and, summed over its steps, what a whole flow did. */
export interface AgentResult {
  output: string;
  toolCalls: { name: string; ok: boolean }[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * What the step's tool calls linked to, one per uri, as the loop collected them. A step's own:
   * `flow.ts` writes them to `run_artifacts`, which is where they are one per uri for the run.
   */
  artifacts: RunArtifact[];
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
  /**
   * Handed each question a tool call's server asked mid-call, once it has been declined. Said on
   * the stream as a notice either way; this is how the step keeps it.
   */
  onElicitation?: (note: ElicitationNote) => void;
  /** The MCP servers' `beforeCompact` hooks for this step, from `HookSession.compaction`. */
  hooks?: AgentLoopHooks;
  /**
   * The run this step belongs to, by id. Every step of a run passes the same one, so on a
   * llama.cpp server they share a slot — and its prompt cache — rather than the up to
   * `maxConcurrentRuns` runs in flight evicting each other's. Absent is a run of no session.
   */
  session?: string;
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
  context = "",
  servers,
  signal,
  onEvent,
  onElicitation,
  hooks,
  session,
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

  const catalog = mcp.catalog(servers);
  // Whether a call only reads, by the tool's own `readOnlyHint` on a row that sets
  // `trustAnnotations`. Fails closed: anything the pool cannot vouch for is a write.
  const reads = (call: ToolCallRequest) => mcp.readsOnly(call.name, { servers });

  // What the model will read, so a request that cannot fit is refused here with its size rather
  // than by the endpoint a round trip later. Zero where the endpoint does not say, or not within
  // agent-core's own bound on the lookup, which guards nothing; a stop ends the wait with the run.
  const contextLength = await contextLimitFor({ ...config, model }, 0, { signal });

  const { turn, toolCalls, usage, artifacts } = await runAgentLoop({
    // A step may run on a model other than the settings row's. The first token gets the same
    // patience as every one after it, where the loop would otherwise wait five times as long.
    config: {
      ...config,
      model,
      contextLength,
      firstTokenSeconds: config.requestTimeoutSeconds,
      reasoningReplay: replayPolicy(config.reasoningReplay),
      // On the run's own endpoint, and only when a model is named: the loop has no fallback to
      // the main model, so an empty column leaves `compact` with nothing to summarise with.
      ...(config.compactionModel
        ? { tasks: { compaction: { model: config.compactionModel, endpoint: config } } }
        : {}),
    },
    system: systemPrompt,
    // The context goes on the step's one question and stays there for the step's whole loop: a
    // run keeps no transcript, so there is no stored message it could leak into. What is said
    // above it is set once in `hooks.ts`, which is the only place a context comes from.
    messages: withContext([{ role: "user", content: prompt }], 0, context),
    tools: mcp.tools({ servers }),
    catalog,
    // On demand, the loop asks the tool-selection model — the step's own where none is set — which
    // tools the prompt needs, and says what it picked in a notice. It is asked the prompt as
    // written: the hooks' context is already on `messages`, and tools picked for what memory
    // recalled are tools for a question nobody asked. Guessing wrong is cheap — an unused
    // definition costs a few hundred tokens for one run, and the model can still load what it
    // actually wanted.
    preselect: true,
    preselectQuery: prompt,
    // A decision, not a default nobody looked at. Sorted by name, a tool loaded on demand lands
    // mid-array and moves every definition after it, where unsorted it is appended and the
    // prefix an endpoint cached still matches.
    toolOrder: false,
    // Two identical calls in one step are two calls — a counter or a "next page" is meant to
    // answer differently the second time — unless the tool is a read on a server whose
    // annotations the operator trusts, which is neither.
    dedupeToolCalls: reads,
    // The operator's call, since only they know whether their tools write: results still go back
    // in the order the model asked, but two writes run together land in the order they finish.
    // `auto` asks the pool per call, and a call it cannot vouch for runs alone, in order.
    parallel: config.toolExecution === "auto" ? reads : config.toolExecution === "parallel",
    // Read off `catalog`, which is passed in every mode. The block is the same text on every
    // request of the step, so past the first it is prompt the endpoint has cached.
    serverInstructions: config.serverInstructions,
    ...(session ? { session } : {}),
    maxContinuations: MAX_CONTINUATIONS,
    // Off unless a compaction model is set, as in min-agent. Also inert where the endpoint did not
    // report a window, since there is nothing to plan three quarters of.
    compact: Boolean(config.compactionModel),
    // Only ever `beforeCompact`: see `compaction` in `hooks.ts`.
    ...(hooks ? { hooks } : {}),
    // Needs no model, so it is on wherever the window is known. Old tool results are stubbed
    // past `COMPACT_AT` of the window, and only for at least `PRUNE_SHARE` of it: the stubs
    // rewrite the prefix, and a prune that wins back a few hundred tokens costs the endpoint its
    // cache of everything after them. It runs ahead of the fold, which then plans from what is
    // left, so a prune that brings the run back under the line spares it the summary's round
    // trip. Each one is said as a notice.
    prune: { at: COMPACT_AT, minShare: PRUNE_SHARE },
    // The loop hands each call the run's signal. Passed on, a stop sends the server the
    // protocol's `notifications/cancelled` and the call rejects at once; dropped, the tool ran to
    // its end or the call timeout, and a write the person stopped still landed.
    //
    // `links` answers with the text the model reads and, beside it, the result's `resource_link`s,
    // which the loop collects as the step's artifacts. The text is what a plain call returns, so
    // the model is told exactly what it was told before.
    //
    // `onLog` hands what the server logs during the call to the loop, which makes each message a
    // `server-log` event under the call's id — for the watcher, never the transcript. The pool
    // can only tell a message is this call's when it is the one request in flight on that
    // connection, so beside a parallel call or a hook on the same server it is not heard here.
    //
    // `onElicit` answers a server that stops mid-call to ask for something, and it is attributed
    // the same way: a question the pool cannot tie to this call goes to no handler and is declined
    // by the pool, unnoted. Either way the answer is `decline` — see `elicitations.ts`.
    dispatch: (call, callSignal, report) =>
      mcp.call(call.name, call.args, {
        servers,
        signal: callSignal,
        links: true,
        onLog: report.log,
        onElicit: declineUnattended(call.name, (note) => {
          notice(describeElicitation(note));
          onElicitation?.(note);
        }),
      }),
    signal,
    onEvent: (event) => {
      if (event.kind === RunEventKind.Notice) {
        console.warn(`[agent] ${event.text}`);
      }
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
    artifacts,
  };
}
