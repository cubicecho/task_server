import {
  ask,
  type CatalogServer,
  capabilitiesFor,
  catalogPrompt,
  errorMessage,
  expandNames,
  getClient,
  inCatalog,
  LOAD_TOOLS,
  LOAD_TOOLS_DEFINITION,
  loadResult,
  PRESELECT_SYSTEM,
  parseJson,
  preselectInput,
  preselection,
  type RunEventInput,
  relaxTools,
  requestedNames,
  runTurn,
  sanitizeTools,
  timeoutMs,
  tryAsk,
} from "@cubicecho/agent-core";
import type OpenAI from "openai";
import type { Settings } from "../db/schema.ts";
import { mcp } from "./mcp.ts";

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
   * Which MCP servers this run may reach, by id, from its task's agent profile. Undefined —
   * which is every task on a server with no profiles — is every connected server, as before.
   */
  servers?: ReadonlySet<string>;
  signal?: AbortSignal;
  /** Called as the run happens, for whoever is watching it. See `@cubicecho/agent-core`. */
  onEvent?: (event: RunEventInput) => void;
}

/** Long tool arguments and results are for the model; a watcher needs the gist. */
const preview = (text: string, limit = 2000) =>
  text.length > limit ? `${text.slice(0, limit)}… (${text.length} chars)` : text;

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
  servers,
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
  const catalog = mcp.catalog(servers);
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
        ? mcp.tools(preselected, servers)
        : onDemand
          ? [LOAD_TOOLS_DEFINITION, ...mcp.tools([...loaded], servers)]
          : mcp.tools(undefined, servers),
    );

    // One turn, with the endpoint's refusals negotiated away and its outages waited out.
    //
    // Both of those used to be written here — a retry loop around a `negotiate` around a
    // `streamStep` — and all three were the copies agent-core was extracted to end. `request`
    // stays a callback because the body has to be rebuilt from whatever the last attempt
    // latched off: `relaxTools` applies to the schemas that were just sanitised.
    const step = await runTurn(
      client,
      supports,
      (supports): OpenAI.ChatCompletionCreateParamsStreaming => {
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
      },
      {
        signal,
        idleMs,
        maxRetries,
        onThinking: (text) => onEvent?.({ kind: "thinking", text }),
        onOutput: (text) => onEvent?.({ kind: "output", text }),
        // Carries both halves — what was given up on, and what is being waited out — so a
        // watcher is told about a downgrade and a retry in the same voice.
        onNotice: (text) => {
          console.warn(`[agent] ${text}`);
          onEvent?.({ kind: "notice", text });
        },
      },
    );
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
          content = await mcp.call(name, args, servers);
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
