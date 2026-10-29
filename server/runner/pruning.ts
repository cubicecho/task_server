import {
  COMPACT_AT,
  messageTokens,
  pruneToolResults,
  type StepWindow,
} from "@cubicecho/agent-core";
import type OpenAI from "openai";

type Message = OpenAI.ChatCompletionMessageParam;

/**
 * The share of the window a prune has to win back before it is worth the prompt cache it costs.
 * Below it the request after a prune is barely smaller than the one before, and every token of it
 * is processed again anyway.
 */
export const PRUNE_SHARE = 0.1;

/** A transcript with its stale tool results stubbed, and what that bought. */
export interface Pruned {
  messages: Message[];
  /** How many tool results were replaced. */
  cleared: number;
  /** Their estimated tokens, less the stubs'. */
  tokens: number;
}

/**
 * A step's transcript with the old tool results cleared, once the window is filling and clearing
 * them is worth it — `undefined` otherwise, which is the loop's "keep what you have".
 *
 * agent-core's `pruneToolResults` rewrites the prefix, and a prefix that changes is a prompt cache
 * that misses, so this runs where `planCompaction` would and no sooner: past `COMPACT_AT` of a
 * window the endpoint reported. A run keeps no transcript beyond its step, so the stubs stay in
 * the loop's own array and the next request extends this one; it is not re-pruned until the
 * window fills again. A prune that would clear less than `PRUNE_SHARE` of the window is not done
 * at all, or a run sitting just over the line would slide the latest-five window forward and
 * lose the cache on every step for a few hundred tokens each time.
 *
 * `used` is the larger of what the last request reported and an estimate of the transcript as it
 * is now, since the report does not count the tool results that arrived after it — which are
 * exactly what fills a window.
 */
export function pruneWhenFilling(
  messages: readonly Message[],
  { used, limit }: Pick<StepWindow, "used" | "limit">,
): Pruned | undefined {
  if (!(limit > 0)) {
    return undefined;
  }
  const given = messages as Message[];
  const estimate = given.reduce((total, message) => total + messageTokens(message), 0);
  if (Math.max(used ?? 0, estimate) < limit * COMPACT_AT) {
    return undefined;
  }
  const pruned = pruneToolResults(given);
  if (pruned === given) {
    return undefined;
  }
  let cleared = 0;
  let tokens = 0;
  pruned.forEach((message, at) => {
    if (message !== given[at]) {
      cleared++;
      tokens += messageTokens(given[at]) - messageTokens(message);
    }
  });
  return tokens >= limit * PRUNE_SHARE ? { messages: pruned, cleared, tokens } : undefined;
}
