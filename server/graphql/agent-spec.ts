import { type AgentSpec, exportSpec, type SpecServer } from "@cubicecho/agent-core";
import { eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { db } from "../db/client.ts";
import { type Agent, agents, type McpServerRow, mcpServers } from "../db/schema.ts";
import { agentLayer } from "../runner/profile.ts";

/**
 * An agent profile as a document another host can read, and one read back into a profile.
 *
 * The format is agent-core's `cubicecho.agent/1` and so is everything that is hard about it —
 * what a document may say, what is dropped from one that says more, and what must not leave a
 * host. What is here is the part only this server knows: which column a field lands in, and
 * which of this server's MCP rows a slug means.
 */

/**
 * Takes out what a document should not spell: a field nobody set, and the section left empty
 * once its fields are gone.
 *
 * The response would lose an `undefined` on its way through JSON anyway, but not the `{}` it
 * leaves behind, nor a `null` column or a blank label — and an exported file is something a
 * person reads and diffs. An empty array stays, because for `tools.servers` it is an answer.
 *
 * One level at a time, by whoever knows the level is this document's own. A hook's `args` are
 * its author's, and an empty string in there is an argument.
 */
function compact<T extends object>(value: T): T {
  const kept = Object.entries(value).filter(([, held]) => {
    if (held === undefined || held === null || held === "") return false;
    return Array.isArray(held) || typeof held !== "object" || Object.keys(held).length > 0;
  });
  return Object.fromEntries(kept) as T;
}

/**
 * One MCP server row as a bundle carries it: how to start or reach it, under the slug the
 * profile's scope names it by.
 *
 * No `id` and no `enabled`. An id is this database's and means nothing in another, and a
 * disabled server is a decision about this host — the importing operator makes their own when
 * they choose whether to create it. Only the arm the transport reads is written, so a row that
 * was once stdio does not travel with a `url` it stopped using.
 */
function bundled(row: McpServerRow): SpecServer {
  const connection =
    row.transport === "http"
      ? { url: row.url, headers: row.headers }
      : { command: row.command, args: row.args, env: row.env };
  return {
    slug: row.slug,
    label: row.label,
    transport: row.transport,
    ...connection,
    hiddenTools: row.hiddenTools,
    hooks: row.hooks,
  };
}

/**
 * A profile row as an agent spec.
 *
 * The columns are `agentLayer`'s, the same projection a run merges over the settings row, so a
 * column at its inherit sentinel is a field the document does not have. Two things are added
 * that a run has no use for: the name, and the scope — `mcpServerIds` respelled as slugs, since
 * a slug is the only name for a server that means anything on another host, with each of those
 * servers' definitions in the bundle so the document can be read where they do not exist yet.
 * An unscoped profile says nothing about servers and bundles none: "every server" is a
 * statement about whichever host is running it.
 *
 * `exportSpec` is what makes it fit to leave: the bundle's `env` and `headers` go, which are
 * where this server keeps other people's credentials. The profile's own key was never in the
 * layer. `args` and `url` travel as written — a token typed into either is not something this
 * can tell from the rest of a command line.
 *
 * No `id`. The row's id is this database's, and a document that carried one would arrive at
 * its importer with a field that host has to drop.
 */
export function agentToSpec(agent: Agent, servers: readonly McpServerRow[]): AgentSpec {
  const layer = agentLayer(agent);
  const scope = new Set(agent.mcpServerIds ?? []);
  // A scope naming a row that has since been deleted is narrower than it reads, not wider: the
  // row that is gone contributes no slug and the list is still a list, down to an empty one,
  // which is what a run on this profile gets today.
  const scoped = servers.filter((server) => scope.has(server.id));
  const narrowed = scope.size > 0;

  const { bundle, ...rest } = exportSpec({
    ...layer,
    name: agent.name,
    description: agent.description,
    tools: { ...layer.tools, ...(narrowed ? { servers: scoped.map((s) => s.slug) } : {}) },
    ...(scoped.length ? { bundle: { mcpServers: scoped.map(bundled) } } : {}),
  });
  return compact({
    ...rest,
    endpoint: compact(rest.endpoint ?? {}),
    model: compact(rest.model ?? {}),
    tools: compact(rest.tools ?? {}),
    retry: compact(rest.retry ?? {}),
    // Compacted on this side of the redaction: a server is written with whatever the library
    // left of it, and nothing here has to name the two fields it took.
    ...(bundle?.mcpServers ? { bundle: { mcpServers: bundle.mcpServers.map(compact) } } : {}),
  });
}

/** The `agentSpec` query: one profile, written down. */
export async function exportAgent(agentId: string): Promise<AgentSpec> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    throw new GraphQLError(`There is no agent with id ${agentId}.`, {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return agentToSpec(agent, await db.select().from(mcpServers));
}
