import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type OpenAI from "openai";
import { db } from "../db/client.ts";
import { type McpServerRow, mcpServers } from "../db/schema.ts";

const SEPARATOR = "__";

export type McpStatus = "disabled" | "connecting" | "ready" | "error";

/** What it takes to reach a server — the connection half of a row, without its identity. */
export type McpConnection = Pick<
  McpServerRow,
  "transport" | "command" | "args" | "env" | "url" | "headers"
>;

function createTransport(config: McpConnection) {
  if (config.transport === "stdio") {
    if (!config.command) throw new Error("a stdio server needs a command");
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      // The child inherits our environment: an MCP server usually needs PATH to find itself.
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
    });
  }
  if (!config.url) throw new Error("an http server needs a url");
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers ?? {} },
  });
}

export interface McpProbe {
  ok: boolean;
  error: string;
  tools: { name: string; description: string }[];
}

/**
 * Connects to a config that may not be saved yet, lists its tools, and hangs up.
 *
 * This is what the "Test connection" button calls: a config is easy to get subtly wrong, and
 * finding out at 3am when the task runs is too late. The client is disposable — the pool keeps
 * the long-lived ones.
 */
export async function probe(config: McpConnection): Promise<McpProbe> {
  const client = new Client({ name: "task-server-probe", version: "0.1.0" });
  try {
    await client.connect(createTransport(config));
    const { tools } = await client.listTools();
    return {
      ok: true,
      error: "",
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? "" })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), tools: [] };
  } finally {
    await client.close().catch(() => {});
  }
}

/** One server's tools, without their JSON schemas — the cheap half of a tool definition. */
export interface CatalogServer {
  id: string;
  label: string;
  tools: { name: string; description: string }[];
}

export interface McpServerState {
  id: string;
  slug: string;
  label: string;
  status: McpStatus;
  error: string;
  tools: { name: string; description: string }[];
}

interface Entry {
  config: McpServerRow;
  client?: Client;
  status: McpStatus;
  error?: string;
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
}

/**
 * One MCP client per configured server, exposing their tools to the agent loop as
 * `<slug>__<tool name>`.
 *
 * Connections are long-lived and shared across runs: a stdio server is a child process, and
 * spawning one per task run would cost more than the run. `sync()` reconciles the pool with
 * the `mcp_servers` table and is called on boot and after every write to it.
 */
class McpPool {
  private entries = new Map<string, Entry>();

  async sync(configs?: McpServerRow[]) {
    const wanted = configs ?? (await db.select().from(mcpServers));
    for (const [id, entry] of this.entries) {
      if (!wanted.some((config) => config.id === id)) {
        await this.close(entry);
        this.entries.delete(id);
      }
    }
    await Promise.all(
      wanted.map(async (config) => {
        const existing = this.entries.get(config.id);
        // Reconnecting an unchanged server would restart its child process for nothing.
        if (existing && JSON.stringify(existing.config) === JSON.stringify(config)) return;
        if (existing) await this.close(existing);
        await this.connect(config);
      }),
    );
  }

  private async connect(config: McpServerRow) {
    const entry: Entry = { config, status: config.enabled ? "connecting" : "disabled", tools: [] };
    this.entries.set(config.id, entry);
    if (!config.enabled) return;

    try {
      const client = new Client({ name: "task-server", version: "0.1.0" });
      await client.connect(createTransport(config));
      const { tools } = await client.listTools();

      entry.client = client;
      entry.status = "ready";
      entry.tools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: (tool.inputSchema ?? { type: "object" }) as Record<string, unknown>,
      }));
      console.log(`[mcp] ${config.slug}: ${entry.tools.length} tool(s)`);
    } catch (error) {
      entry.status = "error";
      entry.error = error instanceof Error ? error.message : String(error);
      console.error(`[mcp] ${config.slug}: ${entry.error}`);
    }
  }

  private async close(entry: Entry) {
    try {
      await entry.client?.close();
    } catch {
      // a server that died on its own is already closed
    }
    entry.client = undefined;
  }

  /** The one place a tool's wire name is built, so `call` and `tools` agree. */
  private static qualify(slug: string, tool: string) {
    return `${slug}${SEPARATOR}${tool}`.slice(0, 64);
  }

  /**
   * Tool definitions for the model. Pass `names` to get only those — on-demand loading sends
   * a handful of schemas instead of every one.
   */
  tools(names?: string[]): OpenAI.ChatCompletionTool[] {
    const wanted = names && new Set(names);
    const tools: OpenAI.ChatCompletionTool[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "ready") continue;
      for (const tool of entry.tools) {
        const name = McpPool.qualify(entry.config.slug, tool.name);
        if (wanted && !wanted.has(name)) continue;
        tools.push({
          type: "function",
          function: {
            name,
            description: `[${entry.config.label || entry.config.slug}] ${tool.description}`.trim(),
            parameters: tool.inputSchema,
          },
        });
      }
    }
    return tools;
  }

  /** Names and descriptions only — what the model browses before loading any schemas. */
  catalog(): CatalogServer[] {
    const catalog: CatalogServer[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "ready" || !entry.tools.length) continue;
      catalog.push({
        id: entry.config.id,
        label: entry.config.label || entry.config.slug,
        tools: entry.tools.map((tool) => ({
          name: McpPool.qualify(entry.config.slug, tool.name),
          description: tool.description,
        })),
      });
    }
    return catalog;
  }

  /** Runs one tool call and returns text for a tool message. */
  async call(qualifiedName: string, input: unknown): Promise<string> {
    const [slug, ...rest] = qualifiedName.split(SEPARATOR);
    const entry = [...this.entries.values()].find((candidate) => candidate.config.slug === slug);
    if (!entry?.client) throw new Error(`MCP server "${slug}" is not connected`);

    const result = await entry.client.callTool({
      name: rest.join(SEPARATOR),
      arguments: (input ?? {}) as Record<string, unknown>,
    });

    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((block: { type?: string; text?: string }) =>
        block.type === "text" ? block.text : `[${block.type ?? "unknown"} content]`,
      )
      .join("\n")
      .trim();

    if (result.isError) throw new Error(text || "tool call failed");
    return text || "(no output)";
  }

  state(): McpServerState[] {
    return [...this.entries.values()].map((entry) => ({
      id: entry.config.id,
      slug: entry.config.slug,
      label: entry.config.label,
      status: entry.status,
      error: entry.error ?? "",
      tools: entry.tools.map(({ name, description }) => ({ name, description })),
    }));
  }

  async shutdown() {
    await Promise.all([...this.entries.values()].map((entry) => this.close(entry)));
    this.entries.clear();
  }
}

export const mcp = new McpPool();
