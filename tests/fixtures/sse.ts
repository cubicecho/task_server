/**
 * Turns a chat completion into the SSE stream a streaming request gets back, so the tests can
 * keep writing whole replies while the runner reads them the way it reads a real server: a
 * token at a time, with tool call arguments arriving in pieces.
 */

interface Completion {
  id: string;
  model: string;
  choices: { message: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: Record<string, number>;
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

/** Small enough that nothing arrives whole, which is the point of streaming it. */
const pieces = (text: string, size = 4) =>
  text ? (text.match(new RegExp(`.{1,${size}}`, "gs") as RegExp) ?? []) : [];

export function sseFrom(completion: Completion, includeUsage: boolean): string {
  const message = completion.choices[0].message;
  const base = {
    id: completion.id,
    object: "chat.completion.chunk",
    created: 0,
    model: completion.model,
  };
  const delta = (value: unknown, finish: string | null = null) =>
    frame({ ...base, choices: [{ index: 0, delta: value, finish_reason: finish }] });

  let out = delta({ role: "assistant" });
  for (const piece of pieces(message.content ?? "")) out += delta({ content: piece });

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

  out += delta({}, message.tool_calls?.length ? "tool_calls" : "stop");
  // Usage rides in a final choice-less chunk, and only when it was asked for.
  if (includeUsage && completion.usage)
    out += frame({ ...base, choices: [], usage: completion.usage });
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
