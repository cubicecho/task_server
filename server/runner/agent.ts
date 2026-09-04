import OpenAI from "openai";
import { errorMessage } from "../../shared/errors.ts";
import type { Settings } from "../db/schema.ts";
import type { RunEventInput } from "./events.ts";
import { getClient, timeoutMs } from "./llm.ts";
import { type CatalogServer, mcp } from "./mcp.ts";
import { isGrammarError, relaxTools, sanitizeTools } from "./schema-compat.ts";
import { ask, parseJson, tryAsk } from "./side-task.ts";
import {
  catalogPrompt,
  expandNames,
  inCatalog,
  LOAD_TOOLS,
  LOAD_TOOLS_DEFINITION,
  loadResult,
  PRESELECT_SYSTEM,
  preselectInput,
  preselection,
  requestedNames,
} from "./tool-loading.ts";

/** What one endpoint turned out not to support. Both start optimistic and only ever latch off. */
interface Capabilities {
  /**
   * llama.cpp-backed servers compile every tool schema into one grammar and reject keywords
   * their converter cannot express — one bad shape from one MCP server fails the whole request.
   * Once we have seen that, the advisory keywords stay off rather than costing every later run
   * a failed call first.
   */
  strictSchemas: boolean;
  /**
   * `stream_options` is how a streamed request asks for its token counts, and a server that has
   * not heard of it rejects the whole request. Dropped for good once that happens: the counts
   * are worth one failed call to find out about, not one per run.
   */
  usageInStream: boolean;
}

/**
 * What each endpoint cannot do, remembered for the life of the process.
 *
 * Keyed by base URL because these are facts about the server on the other end, not about this
 * one: a llama.cpp box that cannot compile a grammar and a cloud API that can are both reachable
 * from the same settings row over its lifetime, and the first one's refusal must not quietly
 * strip pattern/format from the second one's requests forever. Bounded by the number of
 * endpoints ever configured here, which is a settings row's worth.
 */
const capabilities = new Map<string, Capabilities>();

function capabilitiesFor(baseUrl: string): Capabilities {
  let known = capabilities.get(baseUrl);
  if (!known) {
    known = { strictSchemas: true, usageInStream: true };
    capabilities.set(baseUrl, known);
  }
  return known;
}

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
  signal?: AbortSignal;
  /** Called as the run happens, for whoever is watching it. See `runner/events.ts`. */
  onEvent?: (event: RunEventInput) => void;
}

/** The endpoint stopped answering mid-request. Its own class so the retry can recognise it. */
class EndpointSilent extends Error {
  override readonly name = "EndpointSilent";
}

/**
 * Whether a failed request is worth trying again.
 *
 * The question is whether the request was *refused or lost*, rather than answered with a
 * complaint about its contents: a connection that never landed, a server too busy or too broken
 * to answer, an endpoint that went quiet. A 400 for a malformed tool schema would fail exactly
 * the same way on every attempt, and the two capability cases below are negotiated rather than
 * retried blindly.
 */
function isTransient(error: unknown): boolean {
  if (error instanceof EndpointSilent) return true;
  if (error instanceof OpenAI.APIConnectionError) return true;
  if (!(error instanceof OpenAI.APIError)) return false;
  const { status } = error;
  return status === 408 || status === 409 || status === 429 || (status ?? 0) >= 500;
}

/** Exponential, with jitter so several tasks failing at once do not return in lockstep. */
const backoffMs = (attempt: number) =>
  Math.min(8000, 2 ** attempt * 500) * (0.5 + Math.random() / 2);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** One streamed turn, put back together into the shape the loop and the history work with. */
interface Step {
  content: string;
  toolCalls: OpenAI.ChatCompletionMessageToolCall[];
  usage: { prompt: number; completion: number; total: number };
}

/** Reasoning deltas are not in the OpenAI types, and have two spellings in the wild. */
type ReasoningDelta = OpenAI.ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string | null;
  reasoning?: string | null;
};

/** Long tool arguments and results are for the model; a watcher needs the gist. */
const preview = (text: string, limit = 2000) =>
  text.length > limit ? `${text.slice(0, limit)}… (${text.length} chars)` : text;

/**
 * Runs one turn as a stream, reporting tokens as they arrive and assembling them back into a
 * message.
 *
 * Streaming buys no speed here — nothing waits on the reply but the loop itself. It is what
 * makes a run watchable: a task that stalls, loops, or reaches for the wrong tool says so while
 * it is happening, instead of only in the row it leaves behind.
 */
async function streamStep(
  client: OpenAI,
  body: OpenAI.ChatCompletionCreateParamsStreaming,
  {
    signal,
    onEvent,
    produced,
    idleMs,
  }: {
    signal?: AbortSignal;
    onEvent?: (event: RunEventInput) => void;
    /** Set as soon as the server has said anything, so a failed call knows if it can be retried. */
    produced: { any: boolean };
    /** Silence allowed before the request is given up on. Undefined waits forever. */
    idleMs?: number;
  },
): Promise<Step> {
  // Silence, not duration: the timer is rearmed on every chunk, so a model that is still
  // talking is never cut off however long it takes, and one that has stopped talking does not
  // hang the run until someone notices. A request that never answers at all is the same case
  // with no chunks in it.
  const watchdog = new AbortController();
  const linked = signal ? AbortSignal.any([signal, watchdog.signal]) : watchdog.signal;
  let idle: NodeJS.Timeout | undefined;
  const rearm = () => {
    if (!idleMs) return;
    clearTimeout(idle);
    idle = setTimeout(() => watchdog.abort(), idleMs);
  };

  try {
    rearm();
    return await collect();
  } catch (error) {
    // The caller's own stop has to stay distinguishable from ours: one is a run that was
    // called off, the other is an endpoint that stopped answering and may be worth retrying.
    if (watchdog.signal.aborted && !signal?.aborted) {
      throw new EndpointSilent(`the model endpoint sent nothing for ${(idleMs ?? 0) / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(idle);
  }

  async function collect(): Promise<Step> {
    const stream = await client.chat.completions.create(body, { signal: linked });
    const content: string[] = [];
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    const usage = { prompt: 0, completion: 0, total: 0 };

    for await (const chunk of stream) {
      produced.any = true;
      rearm();
      if (chunk.usage) {
        usage.prompt = chunk.usage.prompt_tokens ?? 0;
        usage.completion = chunk.usage.completion_tokens ?? 0;
        usage.total = chunk.usage.total_tokens ?? 0;
      }
      const delta = chunk.choices[0]?.delta as ReasoningDelta | undefined;
      if (!delta) continue;

      const thinking = delta.reasoning_content || delta.reasoning || "";
      if (thinking) onEvent?.({ kind: "thinking", text: thinking });
      if (delta.content) {
        content.push(delta.content);
        onEvent?.({ kind: "output", text: delta.content });
      }
      // Tool calls arrive in pieces, keyed by position: the name in one chunk, the arguments
      // spread across the next several.
      for (const part of delta.tool_calls ?? []) {
        const call = calls.get(part.index) ?? { id: "", name: "", arguments: "" };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
        calls.set(part.index, call);
      }
    }

    // An aborted stream ends its iteration rather than throwing, so without this a turn cut
    // off halfway — by the watchdog or by someone stopping the run — would come back looking
    // like a complete one, and a truncated answer would be recorded as the task's output.
    linked.throwIfAborted();

    return {
      content: content.join(""),
      toolCalls: [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, call]) => ({
          // A server that streams a call without an id still needs one for the result to answer.
          id: call.id || `call_${index}`,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      usage,
    };
  }
}

/**
 * Guesses the tools this task will need, before the run starts.
 *
 * On-demand loading otherwise spends a round trip on reading the catalogue and calling
 * `load_tools`. A small model reading the same catalogue usually picks the right names, and
 * then the task model opens with them already in hand.
 *
 * Guessing wrong is cheap: an unused definition costs a few hundred tokens for one run, and
 * the model can still load what it actually wanted. So this never blocks or overrides the
 * model's own loading — it only tries to make it unnecessary.
 */
async function preselect(
  config: Settings,
  model: string,
  catalog: CatalogServer[],
  prompt: string,
  signal?: AbortSignal,
  onEvent?: (event: RunEventInput) => void,
): Promise<string[]> {
  const reply = await ask(config, model, PRESELECT_SYSTEM, preselectInput(catalog, prompt), {
    maxTokens: 256,
    signal,
  });
  const chosen = preselection(parseJson<unknown>(reply), catalog);
  if (chosen.length) {
    console.log(`[agent] preselected: ${chosen.join(", ")}`);
    onEvent?.({ kind: "notice", text: `tools picked before the run: ${chosen.join(", ")}` });
  }
  return chosen;
}

/**
 * Runs one task to completion: send the prompt, execute whatever MCP tools the model asks
 * for, loop until it stops asking, and return its final reply.
 *
 * Unlike a chat this is not streamed and keeps no history — a task run starts from nothing
 * every time, so the only state is the messages built up inside this call. That also means
 * nothing is learned between runs: whatever the model loads, it loads again next time.
 */
export async function runAgent({
  config,
  model,
  systemPrompt,
  prompt,
  signal,
  onEvent,
}: AgentOptions): Promise<AgentResult> {
  if (!model) throw new Error("No model selected — pick one in Settings.");

  const client = getClient(config);
  const supports = capabilitiesFor(config.baseUrl);
  const idleMs = timeoutMs(config);
  // Both columns are `notNull` with a default, so this is belt and braces — but an unbounded
  // retry loop is a bad way to find out about a row that predates them.
  const maxRetries = Math.max(0, Number(config.maxRetries) || 0);

  // In on-demand mode the model sees a name-only catalogue up front and pulls in the schemas
  // it needs as the run goes; `loaded` grows between iterations.
  const catalog = mcp.catalog();
  const onDemand = config.toolDiscovery === "ondemand" && catalog.length > 0;
  const loaded = new Set<string>();

  const preselected = onDemand
    ? ((await tryAsk("preselect", () =>
        preselect(config, config.toolSelectModel || model, catalog, prompt, signal, onEvent),
      )) ?? [])
    : [];
  for (const name of preselected) loaded.add(name);

  // Rebuilt each iteration: `loaded` grows as the run goes, and the catalogue has to stop
  // advertising a tool the moment the model can actually call it.
  const systemPromptFor = () =>
    onDemand ? `${systemPrompt}\n\n${catalogPrompt(catalog, loaded)}`.trim() : systemPrompt;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPromptFor() },
    { role: "user", content: prompt },
  ];

  const result: AgentResult = {
    output: "",
    toolCalls: [],
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  for (let iteration = 0; iteration < config.maxToolIterations; iteration++) {
    // A stop aborts the request in flight, but a tool call already handed to an MCP server
    // runs to its own end — so the signal is checked between steps as well.
    signal?.throwIfAborted();
    onEvent?.({ kind: "turn", text: `turn ${iteration + 1}` });

    // With a preselection in hand the first step gets the shortlist and nothing else — no
    // catalogue, no `load_tools`. Left with the menu in front of it the model shops: it
    // reloads what it already has, or picks a sibling of the right tool. Taking the menu away
    // for one step removes the choice, and everything comes back on the step after.
    const routed = preselected.length > 0 && iteration === 0;
    messages[0] = { role: "system", content: routed ? systemPrompt : systemPromptFor() };

    // MCP servers emit JSON Schema shapes a strict backend cannot compile — Gmail's, for one.
    // Normalising them here is cheap and cloud providers accept the result unchanged.
    const declared = sanitizeTools(
      routed
        ? mcp.tools(preselected)
        : onDemand
          ? [LOAD_TOOLS_DEFINITION, ...mcp.tools([...loaded])]
          : mcp.tools(),
    );

    const request = (): OpenAI.ChatCompletionCreateParamsStreaming => {
      const tools = supports.strictSchemas ? declared : relaxTools(declared);
      return {
        model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages,
        stream: true,
        ...(supports.usageInStream ? { stream_options: { include_usage: true } } : {}),
        ...(tools.length ? { tools } : {}),
      };
    };

    // One turn, given as many attempts as the settings allow.
    //
    // Two different things are being recovered from here, and they nest. The inner one is a
    // capability the endpoint turns out not to have: it is negotiated away and tried once more,
    // and it latches against that endpoint for the life of the process, so it costs one failed
    // call rather than one a run. The outer one is the endpoint being unreachable, busy or
    // silent, which is not about this request at all and is worth simply waiting out.
    //
    // Both are bounded by the same rule: nothing is retried once the server has started
    // answering. The tokens are already out and on their way to whoever is watching, and a
    // second attempt would say everything twice.
    let step: Step | undefined;
    for (let attempt = 0; ; attempt++) {
      const produced = { any: false };
      try {
        step = await negotiate(produced);
        break;
      } catch (error) {
        if (produced.any || signal?.aborted) throw error;
        if (attempt >= maxRetries || !isTransient(error)) throw error;
        const wait = backoffMs(attempt);
        const detail = errorMessage(error);
        const notice = `${detail} — retrying in ${Math.round(wait / 1000)}s (${attempt + 1}/${maxRetries})`;
        console.warn(`[agent] ${notice}`);
        onEvent?.({ kind: "notice", text: notice });
        await sleep(wait, signal);
      }
    }

    /**
     * Sends the step, re-sending it each time the answer is this endpoint refusing something we
     * can do without.
     *
     * A loop rather than one retry: a server that has heard of neither `stream_options` nor a
     * grammar keyword complains about them one at a time, and answering only the first left the
     * second to fail the request — so the first run against such an endpoint was spent
     * discovering what the second one starts knowing. It terminates in at most one pass per
     * capability, since each pass either latches one off for good or rethrows.
     */
    async function negotiate(produced: { any: boolean }): Promise<Step> {
      for (;;) {
        try {
          return await streamStep(client, request(), { signal, onEvent, produced, idleMs });
        } catch (error) {
          const detail = errorMessage(error);
          if (produced.any) throw error;
          if (supports.strictSchemas && isGrammarError(detail)) {
            const notice = "server could not build a grammar; retrying without pattern/format";
            console.warn(`[agent] ${notice}`);
            onEvent?.({ kind: "notice", text: notice });
            supports.strictSchemas = false;
          } else if (supports.usageInStream && /stream_options/i.test(detail)) {
            console.warn("[agent] server rejected stream_options; token counts unavailable");
            supports.usageInStream = false;
          } else {
            throw error;
          }
        }
      }
    }

    result.promptTokens += step.usage.prompt;
    result.completionTokens += step.usage.completion;
    result.totalTokens += step.usage.total;

    messages.push({
      role: "assistant",
      content: step.content || null,
      ...(step.toolCalls.length ? { tool_calls: step.toolCalls } : {}),
    });

    const calls = step.toolCalls;
    if (!calls.length) {
      result.output = step.content;
      return result;
    }

    for (const call of calls) {
      signal?.throwIfAborted();
      // Only function tools carry a name and arguments; anything else has nothing to run.
      if (call.type !== "function") continue;
      const name = call.function.name;
      let content: string;
      let ok = true;
      onEvent?.({ kind: "tool-call", name, text: preview(call.function.arguments) });
      try {
        const args = parseArgs(call.function.arguments);
        if (name === LOAD_TOOLS) {
          const resolved = expandNames(requestedNames(args), catalog);
          for (const loadedName of resolved.matched) loaded.add(loadedName);
          content = loadResult(resolved, catalog);
          ok = resolved.matched.length > 0;
        } else {
          // A model that skips `load_tools` and calls a catalogued tool straight from its name
          // is right about what it wants; load it and run it rather than erroring.
          if (onDemand && !loaded.has(name) && inCatalog(catalog, name)) loaded.add(name);
          content = await mcp.call(name, args);
        }
      } catch (error) {
        content = errorMessage(error);
        ok = false;
      }
      // `load_tools` is recorded alongside the real calls: the run history is what the task
      // actually did, and "spent three steps loading tools" is part of that.
      result.toolCalls.push({ name, ok });
      onEvent?.({ kind: "tool-result", name, ok, text: preview(content) });
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  throw new Error(`Stopped after ${config.maxToolIterations} tool iterations.`);
}

function parseArgs(args: string): Record<string, unknown> {
  if (!args.trim()) return {};
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    throw new Error(`model produced invalid tool arguments: ${args.slice(0, 200)}`);
  }
}
