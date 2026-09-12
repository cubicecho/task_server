import type { PromptMessage } from "@modelcontextprotocol/sdk/types.js";
import { mcp } from "./mcp.ts";

/**
 * The prompts the configured MCP servers offer, as something a person picks rather than
 * something a model calls.
 *
 * A prompt is the server author's own phrasing of a job their server is good at — "review this
 * diff", "explain this query plan" — parameterised and written by whoever knows the server best.
 * This one indexed `tools/list` and nothing else, so a server could ship a dozen of them and
 * none of it reached anyone here.
 *
 * They go to the task editor and not to a run, which is the protocol's own division rather than
 * a taste: prompts are user-controlled, meant to be surfaced as menu items and slash commands.
 * Expanded here they become the text of a task's prompt — editable before it is saved, and
 * stored as the prompt, so what a run sends is what is in the box. A template resolved at run
 * time would be a prompt whose text nobody can read back off the task, changing under the task
 * whenever the server that wrote it changed its mind.
 */

/** One blank in a template, as the server declared it. */
export interface McpPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

/** One prompt on offer. `server` is the row id, which is what addresses a `get`. */
export interface McpPromptRow {
  server: string;
  serverLabel: string;
  name: string;
  title: string;
  description: string;
  arguments: McpPromptArgument[];
}

/**
 * The connected servers that said in the handshake that they have prompts, in configuration
 * order.
 *
 * `capabilities` is what the server declared, which the pool reports off `state()`. Asking one
 * that never claimed it is an error round trip per server per listing, and the SDK's client
 * refuses the call anyway — so the capability is the filter rather than a `try` around the
 * whole set.
 */
const promptServers = () =>
  mcp
    .state()
    .filter((server) => server.status === "ready" && server.capabilities?.prompts)
    .map(({ id, label }) => ({ id, label }));

/** Every prompt every prompt-serving server offers. */
export async function list(): Promise<McpPromptRow[]> {
  // A reconnect owed from a write that just landed is paid off first, the same as `mcpStatus`
  // does: a picker opened straight after a server was saved should be asking that server.
  await mcp.flush();

  const listings = await Promise.all(
    promptServers().map(async ({ id, label }) => {
      try {
        const { prompts } = await (await mcp.client(id)).listPrompts();
        return prompts.map((prompt) => ({
          server: id,
          serverLabel: label,
          name: prompt.name,
          title: prompt.title ?? "",
          description: prompt.description ?? "",
          arguments: (prompt.arguments ?? []).map((argument) => ({
            name: argument.name,
            description: argument.description ?? "",
            required: argument.required ?? false,
          })),
        }));
      } catch {
        // A server that cannot be listed is a server with none, as far as a picker is concerned.
        // The MCP servers page is where a broken connection is diagnosed and it already says so;
        // failing the whole query here would empty the picker of the servers that answered.
        return [];
      }
    }),
  );
  return listings.flat();
}

/**
 * One prompt expanded with the arguments given, flattened to the single string a prompt box is.
 *
 * `prompts/get` answers with *messages* — a list, each with a role — and a task's prompt is one
 * string. The common case is a template that returns exactly one message, and that one arrives
 * verbatim. Where a server returns several the roles are labelled and the text joined, which is
 * lossy: an `assistant` turn in a template is a worked example the server wanted in the history,
 * and as a line inside the prompt it is a quotation of one. Labelling it leaves the model able
 * to read it as one, where dropping the roles would not.
 */
export async function get(
  server: string,
  name: string,
  args: Record<string, string>,
): Promise<string> {
  if (!promptServers().some((offered) => offered.id === server)) {
    throw new Error(`${server} is not a connected MCP server that offers prompts.`);
  }

  const { messages } = await (await mcp.client(server)).getPrompt({ name, arguments: args });
  if (messages.length === 1) return messageText(messages[0].content).trim();
  return messages
    .map((message) => `${message.role}: ${messageText(message.content).trim()}`)
    .join("\n\n")
    .trim();
}

/**
 * One message's content as text, with what has none named rather than dropped.
 *
 * A prompt message carries the same content blocks a tool result does: an image a server pasted
 * in, a file it embedded. The placeholder is what the pool's own `resultText` settled on — the
 * person reading the box can see that something was there and did not survive the trip through
 * a text field, rather than finding a gap where it was.
 */
function messageText(content: PromptMessage["content"]): string {
  if (content.type === "text") return content.text;
  if (content.type === "resource") {
    if ("text" in content.resource && typeof content.resource.text === "string") {
      return content.resource.text;
    }
    return `[resource content at ${content.resource.uri}]`;
  }
  if (content.type === "resource_link") return `[resource link to ${content.uri}]`;
  return `[${content.type} content]`;
}
