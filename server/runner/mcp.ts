import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type OpenAI from "openai";
import { errorMessage } from "../../shared/errors.ts";
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
    return { ok: false, error: errorMessage(error), tools: [] };
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

/**
 * One tool of one connected server, in every shape anything asks for it.
 *
 * The OpenAI definition is built once here rather than per request: the agent loop rebuilds its
 * tool array on every iteration of every step, and the schema behind it cannot change without
 * the connection being torn down and made again.
 */
interface PooledTool {
  /** As the server named it — what `state()` reports and what a call is sent back under. */
  name: string;
  description: string;
  /** `<slug>__<name>`: what the model sees, and what it calls. */
  qualified: string;
  definition: OpenAI.ChatCompletionTool;
}

interface Entry {
  config: McpServerRow;
  client?: Client;
  status: McpStatus;
  error?: string;
  tools: PooledTool[];
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
  /**
   * Qualified name -> the client that answers it. Only ever holds callable tools.
   *
   * `serverId` rides along so a run scoped to a few servers can be held to them by name: an
   * agent profile narrows what is *offered*, and `call` refuses the rest, since a model that
   * remembers a tool from a wider run would otherwise still reach it.
   */
  private index = new Map<string, { client: Client; tool: PooledTool; serverId: string }>();

  /**
   * Whatever the pool is already doing. Reconciling is a sequence of awaits over a map, and two
   * callers interleaving in it both see the same unchanged entry, both spawn a child for it, and
   * the second overwrites the first — whose process is still running with nothing left holding a
   * handle to close it. Chaining is enough: a sync is rare and never on a run's hot path.
   */
  private running: Promise<void> = Promise.resolve();
  private pending?: NodeJS.Timeout;
  /** A write has landed that the pool has not been reconciled for yet. */
  private owed = false;

  /** Runs `work` after whatever is already queued. See `running`. */
  private queue(work: () => Promise<void>): Promise<void> {
    const next = this.running.then(work);
    // The chain has to outlive a failure, or every later reconcile inherits its rejection. The
    // caller still gets the error; this copy exists only to keep the queue moving.
    this.running = next.catch(() => {});
    return next;
  }

  sync(configs?: McpServerRow[]): Promise<void> {
    return this.queue(() => this.reconcile(configs));
  }

  /**
   * Reconciles shortly after a write, rather than during it.
   *
   * The same reason `cron.syncSoon` exists: a write hook runs inside the mutation's transaction,
   * so reading `mcp_servers` from there sees the table as it stood before the write being
   * reacted to. Waiting past the commit also folds a batch of edits into one reconnect, which
   * for a stdio server is a child process not spawned twice.
   */
  syncSoon() {
    this.owed = true;
    clearTimeout(this.pending);
    this.pending = setTimeout(() => void this.settle(), 50);
  }

  private async settle() {
    this.owed = false;
    await this.sync().catch((error) => console.error("[mcp] sync failed:", error));
  }

  /**
   * Pays off a debounced reconnect now, for a reader that would otherwise be shown the pool as
   * it stood before its own write.
   *
   * `create_mcp_server` then `mcp_status` is how an agent on `/mcp` confirms that a server it
   * just added actually connected, and those two calls arrive milliseconds apart. The debounce
   * is left standing rather than disarmed, for the reason `cron.flush` leaves it: the timer may
   * belong to someone else's write whose transaction has not committed yet.
   */
  async flush() {
    if (this.owed) await this.settle();
  }

  private async reconcile(configs?: McpServerRow[]) {
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
    this.reindex();
  }

  /** Rebuilt whenever the pool changes, so `call` resolves a name without scanning for it. */
  private reindex() {
    this.index.clear();
    for (const entry of this.entries.values()) {
      const { client } = entry;
      if (entry.status !== "ready" || !client) continue;
      for (const tool of entry.tools) {
        this.index.set(tool.qualified, { client, tool, serverId: entry.config.id });
      }
    }
  }

  private async connect(config: McpServerRow) {
    const entry: Entry = { config, status: config.enabled ? "connecting" : "disabled", tools: [] };
    this.entries.set(config.id, entry);
    if (!config.enabled) return;

    try {
      const client = new Client({ name: "task-server", version: "0.1.0" });
      await client.connect(createTransport(config));
      const { tools } = await client.listTools();

      const label = config.label || config.slug;
      entry.client = client;
      entry.status = "ready";
      entry.tools = tools.map((tool) => {
        const qualified = McpPool.qualify(config.slug, tool.name);
        const description = tool.description ?? "";
        return {
          name: tool.name,
          description,
          qualified,
          definition: {
            type: "function",
            function: {
              name: qualified,
              description: `[${label}] ${description}`.trim(),
              parameters: (tool.inputSchema ?? { type: "object" }) as Record<string, unknown>,
            },
          },
        };
      });
      console.log(`[mcp] ${config.slug}: ${entry.tools.length} tool(s)`);
    } catch (error) {
      entry.status = "error";
      entry.error = errorMessage(error);
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
   *
   * `servers` is the run's scope, from its agent profile: a set of server ids, or undefined for
   * every connected server. It is applied here as well as in `catalog` because a name can also
   * arrive from `load_tools`, where the model rather than the pool chose it.
   */
  tools(names?: string[], servers?: ReadonlySet<string>): OpenAI.ChatCompletionTool[] {
    const entries = names ? names.map((name) => this.index.get(name)) : [...this.index.values()];
    const definitions: OpenAI.ChatCompletionTool[] = [];
    for (const found of entries) {
      if (!found || (servers && !servers.has(found.serverId))) continue;
      definitions.push(found.tool.definition);
    }
    return definitions;
  }

  /** Names and descriptions only — what the model browses before loading any schemas. */
  catalog(servers?: ReadonlySet<string>): CatalogServer[] {
    const catalog: CatalogServer[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "ready" || !entry.tools.length) continue;
      if (servers && !servers.has(entry.config.id)) continue;
      catalog.push({
        id: entry.config.id,
        label: entry.config.label || entry.config.slug,
        tools: entry.tools.map((tool) => ({
          name: tool.qualified,
          description: tool.description,
        })),
      });
    }
    return catalog;
  }

  /** Runs one tool call and returns text for a tool message. */
  async call(
    qualifiedName: string,
    input: unknown,
    servers?: ReadonlySet<string>,
  ): Promise<string> {
    // Resolved by the whole qualified name rather than by splitting it: `qualify` truncates at
    // 64 characters, and the split of a truncated name names a tool its server never had.
    const found = this.index.get(qualifiedName);
    // A tool outside this run's scope is answered as one that does not exist, because to this
    // run it does not: saying "that server is not yours" would teach the model to ask again.
    if (!found || (servers && !servers.has(found.serverId))) {
      throw new Error(`no connected MCP server offers a tool called "${qualifiedName}"`);
    }

    const result = await found.client.callTool({
      name: found.tool.name,
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
    clearTimeout(this.pending);
    this.owed = false;
    // Queued like a sync, so a reconnect already under way finishes before its children are
    // closed — otherwise shutdown closes entries the sync is in the middle of replacing.
    await this.queue(async () => {
      await Promise.all([...this.entries.values()].map((entry) => this.close(entry)));
      this.entries.clear();
      this.index.clear();
    });
  }
}

export const mcp = new McpPool();
