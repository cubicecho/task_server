import type OpenAI from "openai";
import type { Settings } from "../db/schema.ts";
import { getClient } from "./llm.ts";
import { mcp } from "./mcp.ts";
import { isGrammarError, relaxTools, sanitizeTools } from "./schema-compat.ts";

/**
 * llama.cpp-backed servers compile every tool schema into one grammar and reject keywords
 * their converter cannot express — one bad shape from one MCP server fails the whole request.
 * Once we have seen that, the advisory keywords stay off for the life of the process rather
 * than costing every later run a failed call first.
 */
let strictSchemas = true;

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
}

/**
 * Runs one task to completion: send the prompt, execute whatever MCP tools the model asks
 * for, loop until it stops asking, and return its final reply.
 *
 * Unlike a chat this is not streamed and keeps no history — a task run starts from nothing
 * every time, so the only state is the messages built up inside this call. Every tool
 * definition is sent up front: a task's prompt is fixed and written by hand, so the
 * on-demand catalogue a chat needs buys nothing here.
 */
export async function runAgent({
  config,
  model,
  systemPrompt,
  prompt,
  signal,
}: AgentOptions): Promise<AgentResult> {
  if (!model) throw new Error("No model selected — pick one in Settings.");

  const client = getClient(config);
  // MCP servers emit JSON Schema shapes a strict backend cannot compile — Gmail's, for one.
  // Normalising them here is cheap and cloud providers accept the result unchanged.
  const tools = sanitizeTools(mcp.tools());
  const relaxed = relaxTools(tools);
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
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
    const complete = (strict: boolean) => {
      const declared = strict ? tools : relaxed;
      return client.chat.completions.create(
        {
          model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          messages,
          ...(declared.length ? { tools: declared } : {}),
        },
        { signal },
      );
    };

    let completion: Awaited<ReturnType<typeof complete>>;
    try {
      completion = await complete(strictSchemas);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!strictSchemas || !isGrammarError(detail)) throw error;
      console.warn("[agent] server could not build a grammar; retrying without pattern/format");
      strictSchemas = false;
      completion = await complete(false);
    }

    result.promptTokens += completion.usage?.prompt_tokens ?? 0;
    result.completionTokens += completion.usage?.completion_tokens ?? 0;
    result.totalTokens += completion.usage?.total_tokens ?? 0;

    const message = completion.choices[0]?.message;
    if (!message) throw new Error("the model returned no message");
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (!calls.length) {
      result.output = message.content ?? "";
      return result;
    }

    for (const call of calls) {
      // Only function tools carry a name and arguments; anything else has nothing to run.
      if (call.type !== "function") continue;
      let content: string;
      let ok = true;
      try {
        content = await mcp.call(call.function.name, parseArgs(call.function.arguments));
      } catch (error) {
        content = error instanceof Error ? error.message : String(error);
        ok = false;
      }
      result.toolCalls.push({ name: call.function.name, ok });
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
