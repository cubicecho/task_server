import type { RunArtifact } from "@cubicecho/agent-core";
import { inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { mcpServers, runArtifacts } from "../db/schema.ts";
import { mcp } from "./mcp.ts";

/**
 * Where a person views a link's resource, when that is not its `uri`. MCP has no field for it —
 * a `resource_link` names something its server can read back, not a page — so the producing
 * server says it under its own `_meta` key, the one place the spec leaves for that.
 */
export const WEB_URL_META = "com.cubicecho/webUrl";

/** The `__` agent-mcp-pool qualifies a tool with, for a name the pool no longer knows. */
const SEPARATOR = "__";

interface Origin {
  serverId: string | null;
  serverSlug: string;
  tool: string;
}

/**
 * Which server and tool each qualified name is: asked of the pool, and the slug of the table.
 *
 * Not split on the separator where the pool still knows the name: `qualify` substitutes and may
 * shorten what a server calls its tool, so neither half of a qualified name is reliably either
 * thing. Splitting is the fallback for a server reconfigured between the call and the end of its
 * step, whose name is still worth keeping when an id the pool cannot vouch for is not.
 */
async function origins(
  names: Iterable<string>,
  servers: ReadonlySet<string> | undefined,
): Promise<(name: string) => Origin> {
  const known = new Map<string, { serverId: string; tool: string }>();
  for (const name of names) {
    const info = mcp.describe(name, { servers, hidden: true });
    if (info) {
      known.set(name, { serverId: info.serverId, tool: info.name });
    }
  }
  const ids = [...new Set([...known.values()].map((entry) => entry.serverId))];
  const slugs = new Map(
    ids.length
      ? (
          await db
            .select({ id: mcpServers.id, slug: mcpServers.slug })
            .from(mcpServers)
            .where(inArray(mcpServers.id, ids))
        ).map((row) => [row.id, row.slug])
      : [],
  );

  return (name) => {
    const entry = known.get(name);
    const at = name.indexOf(SEPARATOR);
    const serverSlug = at > 0 ? name.slice(0, at) : "";
    if (entry) {
      return {
        serverId: entry.serverId,
        serverSlug: slugs.get(entry.serverId) ?? serverSlug,
        tool: entry.tool,
      };
    }
    return { serverId: null, serverSlug, tool: at > 0 ? name.slice(at + SEPARATOR.length) : name };
  };
}

/** `annotations.lastModified` as a date, or null where it was absent or not one. */
function modifiedAt(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface RecordArtifacts {
  runId: string;
  taskId: string;
  /** The `run_steps` row of the step whose loop reported them. */
  runStepId: string;
  /** One step's artifacts, as `runAgentLoop` collected them: one per uri already. */
  artifacts: RunArtifact[];
  /** The run's MCP scope, so a name is resolved as the call that made it was. */
  servers?: ReadonlySet<string>;
}

/**
 * Writes one step's artifacts onto its run, one row per uri across the whole run.
 *
 * The loop dedupes within a step; a run has several, so a uri this run already has updates its
 * row instead — `count` goes up, `updatedAt` moves, and the latest `title` and `lastModified` the
 * server gave win. What the row first said of where it came from stays: the step that first made
 * it is the one that made it.
 */
export async function recordArtifacts({
  runId,
  taskId,
  runStepId,
  artifacts,
  servers,
}: RecordArtifacts): Promise<void> {
  if (artifacts.length === 0) {
    return;
  }
  const now = new Date();
  const originOf = await origins(new Set(artifacts.map((artifact) => artifact.tool)), servers);
  const rows = artifacts.map(({ link, tool, count }) => {
    const webUrl = link._meta?.[WEB_URL_META];
    return {
      runId,
      taskId,
      runStepId,
      ...originOf(tool),
      uri: link.uri,
      name: link.name,
      title: link.title ?? "",
      mimeType: link.mimeType ?? "",
      description: link.description ?? "",
      lastModified: modifiedAt(link.annotations?.lastModified),
      webUrl: typeof webUrl === "string" ? webUrl : "",
      count,
      createdAt: now,
      updatedAt: now,
    };
  });

  const excluded = (column: string) => sql.raw(`excluded."${column}"`);
  await db
    .insert(runArtifacts)
    .values(rows)
    .onConflictDoUpdate({
      target: [runArtifacts.runId, runArtifacts.uri],
      set: {
        count: sql`${runArtifacts.count} + ${excluded("count")}`,
        // A later link that leaves a field out has not said it changed.
        title: sql`coalesce(nullif(${excluded("title")}, ''), ${runArtifacts.title})`,
        lastModified: sql`coalesce(${excluded("lastModified")}, ${runArtifacts.lastModified})`,
        updatedAt: now,
      },
    });
}
