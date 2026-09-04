import OpenAI from "openai";
import type { Settings } from "../db/schema.ts";
import { getClient } from "./llm.ts";

/**
 * One-shot calls that support a run without being one — picking tools, for now. Small prompt,
 * short answer, no tools, and never worth failing the run they support.
 */

/**
 * Reasoning models will happily spend a whole budget deliberating over a six-word answer and
 * return empty content, so side tasks ask for thinking to be turned off. `reasoning_effort` is
 * the OpenAI-compatible spelling and `chat_template_kwargs` the llama.cpp/vLLM one; servers
 * disagree about which they take, so send both. One that rejects the unknown fields gets a
 * single retry without them, and is not offered them again.
 */
const NO_THINKING = {
  reasoning_effort: "none",
  chat_template_kwargs: { enable_thinking: false },
};

/**
 * The endpoints that turned out not to take the hints, by base URL.
 *
 * Keyed for the reason `agent.ts` keys its capabilities: a refusal is a fact about the server on
 * the other end, not about this one. A llama.cpp box and a cloud API are both reachable from the
 * same settings row over its lifetime, and the first one's refusal must not stop the second from
 * ever being asked.
 */
const noHints = new Set<string>();

/**
 * Whether a failure is the server complaining about the request, rather than failing to answer.
 *
 * The retry below used to catch everything, so an aborted first call — or a connection that
 * never landed — latched the hints off for the life of the process and every later side task
 * paid for it by burning a whole budget on deliberation. Only a 4xx says the fields were the
 * problem; a timeout, a refused connection or a 500 say nothing about them at all.
 */
function rejectedTheRequest(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  const status = error.status ?? 0;
  return status >= 400 && status < 500;
}

/** Reasoning models that ignore the hints still fence their scratchpad; drop it. */
const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, "");

export interface SideTaskOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** Runs a side task and returns the reply text, thinking stripped. Throws like any request. */
export async function ask(
  config: Settings,
  model: string,
  system: string,
  user: string,
  { maxTokens = 512, temperature = 0.3, signal }: SideTaskOptions = {},
): Promise<string> {
  const send = (hints: boolean) =>
    getClient(config).chat.completions.create(
      {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(hints ? NO_THINKING : {}),
      } as OpenAI.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );

  const hints = !noHints.has(config.baseUrl);
  let response: Awaited<ReturnType<typeof send>>;
  try {
    response = await send(hints);
  } catch (error) {
    if (!hints || !rejectedTheRequest(error)) throw error;
    console.warn("[side-task] server rejected the no-thinking hints; retrying without them");
    noHints.add(config.baseUrl);
    response = await send(false);
  }

  return stripThinking(response.choices[0]?.message?.content ?? "").trim();
}

/**
 * A side task is never worth failing the work it supports. Callers that can carry on without
 * an answer use this and get `undefined` instead of an exception.
 */
export async function tryAsk<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    console.warn(`[side-task] ${label}:`, (error as Error).message);
    return undefined;
  }
}

/**
 * Models are asked for JSON and often answer with prose around it, or a fenced block. Pull out
 * the first array or object rather than failing the task over a wrapper.
 */
export function parseJson<T>(text: string): T | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) return undefined;
  const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
  if (end <= start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}
