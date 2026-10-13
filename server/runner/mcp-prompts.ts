import { resultText, serversWith } from "@cubicecho/agent-mcp-pool";
import { mcp } from "./mcp.ts";

/**
 * The prompts the configured MCP servers offer, as something a person picks rather than
 * something a model calls.
 *
 * Prompts are the user-controlled half of the protocol, so they go to the task editor and not
 * to a run. Expanded here they become the text of a task's prompt: editable before it is saved,
 * and stored, so what a run sends is what is in the box. A template resolved at run time would
 * change under the task whenever its server's author rephrased it.
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
const promptServers = () => serversWith(mcp.state(), "prompts");

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
 * `prompts/get` answers with a list of messages, each with a role. One message arrives
 * verbatim. Several are joined with their roles in front, which is lossy but leaves the model
 * able to read an `assistant` turn as the worked example it was.
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
  if (messages.length === 1) {
    return messageText(messages[0].content);
  }
  return messages
    .map((message) => `${message.role}: ${messageText(message.content)}`)
    .join("\n\n")
    .trim();
}

/**
 * One message's content as text, with what has none named rather than dropped.
 *
 * A prompt message carries the same content blocks a tool result does, one at a time, so it is
 * flattened by the pool's own `resultText` as a one-block result: the person reading the box sees
 * the placeholder a model reads in a tool result, and a `resource_link` keeps the uri and name
 * that make it worth following.
 */
const messageText = (content: unknown) => resultText({ content: [content] });
