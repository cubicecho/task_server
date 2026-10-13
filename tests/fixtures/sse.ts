/**
 * Turns a chat completion into the SSE stream a streaming request gets back, so the tests can
 * keep writing whole replies while the runner reads them the way it reads a real server: a
 * token at a time, with tool call arguments arriving in pieces.
 */

interface Message {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
}

export interface Completion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: { index: number; message: Message; finish_reason: FinishReason }[];
  usage?: Record<string, number>;
}

interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/** `length` is a reply cut off at the ceiling, which the runner carries on from. */
type FinishReason = "stop" | "length";

/** What a fake model is sent, as far as any test reads it. */
export interface ChatBody {
  messages: { role: string; content: string }[];
  tools?: { function: { name: string; parameters?: unknown } }[];
  response_format?: unknown;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

/**
 * One whole reply from the model: text, or a message for anything text cannot say.
 *
 * Every reply costs fifteen tokens, so a test that sums usage across turns can count them.
 */
export const completion = (
  message: string | Message,
  finishReason: FinishReason = "stop",
): Completion => ({
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 0,
  model: "fake",
  choices: [
    {
      index: 0,
      message: typeof message === "string" ? { role: "assistant", content: message } : message,
      finish_reason: finishReason,
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

/** A reply that is one tool call and nothing else. */
export const toolCall = (name: string, args = "{}", id = "call-1") =>
  completion({
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  });

/** The user message of a request, which is where a step's prompt and its context land. */
export const userPrompt = (body: ChatBody) =>
  body.messages.find((message) => message.role === "user")?.content ?? "";

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

/** Small enough that nothing arrives whole, which is the point of streaming it. */
const pieces = (text: string, size = 4) =>
  text ? (text.match(new RegExp(`.{1,${size}}`, "gs") as RegExp) ?? []) : [];

export function sseFrom(completion: Completion, includeUsage: boolean): string {
  const { message, finish_reason } = completion.choices[0];
  const base = {
    id: completion.id,
    object: "chat.completion.chunk",
    created: 0,
    model: completion.model,
  };
  const delta = (value: unknown, finish: string | null = null) =>
    frame({ ...base, choices: [{ index: 0, delta: value, finish_reason: finish }] });

  let out = delta({ role: "assistant" });
  for (const piece of pieces(message.content ?? "")) {
    out += delta({ content: piece });
  }

  for (const [index, call] of (message.tool_calls ?? []).entries()) {
    out += delta({
      tool_calls: [
        { index, id: call.id, type: "function", function: { name: call.function.name } },
      ],
    });
    for (const piece of pieces(call.function.arguments)) {
      out += delta({ tool_calls: [{ index, function: { arguments: piece } }] });
    }
  }

  out += delta({}, message.tool_calls?.length ? "tool_calls" : finish_reason);
  // Usage rides in a final choice-less chunk, and only when it was asked for.
  if (includeUsage && completion.usage) {
    out += frame({ ...base, choices: [], usage: completion.usage });
  }
  return `${out}data: [DONE]\n\n`;
}

/** Answers one request the way the model server would, streamed or not. */
export function replyWith(
  response: import("node:http").ServerResponse,
  completion: Completion,
  body: { stream?: boolean; stream_options?: { include_usage?: boolean } },
) {
  if (!body.stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(completion));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(sseFrom(completion, !!body.stream_options?.include_usage));
}

/**
 * Answers 404 to anything that is not a chat request, and says whether it did.
 *
 * A run asks its endpoint what it serves before it sends a turn — `/models`, then the native
 * routes — and a fake that treats every request as a chat would spend a scripted reply on each.
 */
export function notChat(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): boolean {
  if (request.method === "POST" && request.url?.endsWith("/chat/completions")) {
    return false;
  }
  request.resume();
  response.writeHead(404, { "content-type": "application/json" }).end("{}");
  return true;
}
