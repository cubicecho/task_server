import { mcp } from "./mcp.ts";

/**
 * The prompts the configured MCP servers offer, as something a person picks rather than
 * something a model calls.
 *
 * Prompts are the user-controlled half of the protocol, so they go to the task editor and not
 * to a run. Expanded they become the text of a task's prompt: editable before it is saved, and
 * stored, so what a run sends is what is in the box. A template resolved at run time would
 * change under the task whenever its server's author rephrased it.
 *
 * The protocol work is the pool's — the listing to its last page, the capability check, the
 * flattening of messages to one string (`promptText`) and argument completion. What is left here
 * is the shape the picker reads, with a server's label on every row.
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
 * Every prompt every prompt-serving server offers, in configuration order.
 *
 * A server that failed to answer comes back from the pool with no prompts and a reason, and is
 * a server with none as far as a picker is concerned: the MCP servers page is where a broken
 * connection is diagnosed, and it already says so.
 */
export async function list(): Promise<McpPromptRow[]> {
  // A reconnect owed from a write that just landed is paid off first, the same as `mcpStatus`
  // does: a picker opened straight after a server was saved should be asking that server.
  await mcp.flush();

  const labels = new Map(mcp.state().map((server) => [server.id, server.label]));
  const listings = await mcp.prompts();
  return listings.flatMap(({ serverId, prompts }) =>
    prompts.map((prompt) => ({
      server: serverId,
      serverLabel: labels.get(serverId) ?? serverId,
      name: prompt.name,
      title: prompt.title ?? "",
      description: prompt.description ?? "",
      arguments: (prompt.arguments ?? []).map((argument) => ({
        name: argument.name,
        description: argument.description ?? "",
        required: argument.required ?? false,
      })),
    })),
  );
}

/**
 * One prompt expanded with the arguments given, as the single string a prompt box is. A server
 * that did not declare `prompts` is an `McpPoolError` of code `unsupported` before anything is
 * sent.
 */
export const get = (server: string, name: string, args: Record<string, string>) =>
  mcp.expandPrompt(server, name, args);

/**
 * What a server suggests for one of a prompt's arguments, given what is typed so far and the
 * arguments already filled in. A server that cannot complete answers none rather than an error,
 * so the picker asks on every pause in typing without first asking who is worth asking.
 */
export const complete = (
  server: string,
  name: string,
  argument: { name: string; value: string },
  context: Record<string, string>,
) => mcp.complete(server, { type: "ref/prompt", name }, argument, context);
