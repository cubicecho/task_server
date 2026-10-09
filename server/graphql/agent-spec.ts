import { type AgentSpec, exportSpec, parseSpec, type SpecServer } from "@cubicecho/agent-core";
import { eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { HOOK_EVENTS_FIRED } from "../../shared/hooks.ts";
import { db } from "../db/client.ts";
import { type Agent, agents, type McpServerRow, mcpServers } from "../db/schema.ts";
import { mcp } from "../runner/mcp.ts";
import { agentLayer } from "../runner/profile.ts";
import { NEW_MCP_SERVER, shapeProblems, splitHookProblems } from "./mcp-server.ts";

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

/** What the operator chose for this import, which the document cannot choose for them. */
export interface ImportOptions {
  /**
   * The bundled servers to create, by slug. Absent is none: a bundle is a command line somebody
   * else wrote, and nothing here runs one because a file said so.
   */
  createServers?: readonly string[] | null;
  /** A name to save the profile under instead of the document's own. */
  name?: string | null;
}

/** The profile columns an import fills in. The key is not among them, and never will be. */
export type ImportedAgent = Pick<
  Agent,
  | "name"
  | "description"
  | "baseUrl"
  | "model"
  | "systemPrompt"
  | "maxTokens"
  | "temperature"
  | "maxToolIterations"
  | "toolDiscovery"
  | "toolSelectModel"
  | "requestTimeoutSeconds"
  | "maxRetries"
>;

/** One server the profile would be narrowed to. */
export interface ScopedServer {
  slug: string;
  label: string;
  /** Made by this import, from the bundle, rather than found here already. */
  created: boolean;
}

/** One server the document bundles, and what this import would do about it. */
export interface BundledServer {
  slug: string;
  label: string;
  transport: string;
  /** What creating it would run or dial: the command line, or the url. */
  target: string;
  /** The names of the variables it is given. Names only — a preview is not where a value goes. */
  envNames: string[];
  headerNames: string[];
  /** A server with this slug is here already. */
  exists: boolean;
  /** The operator named it, so the write would create it. */
  create: boolean;
  /** Whether a form should offer it ticked. See `readBundled`. */
  createByDefault: boolean;
  /** Why it could not be saved as written. Creating it is refused while this holds anything. */
  problems: string[];
  /** What is worth knowing about it that stops nothing. */
  notes: string[];
}

type NewMcpServer = typeof mcpServers.$inferInsert;

/** What an import would do, decided before anything is written. */
export interface ImportPlan {
  /** Why nothing will be written. Empty means the write would go ahead. */
  refusals: string[];
  /** What the parser dropped or remarked on, in its words, then this host's own remarks. */
  warnings: string[];
  /** What the document says that a profile here has no column for, and so will not keep. */
  dropped: string[];
  /** The profile as it would be saved. Null when the document could not be read at all. */
  agent: ImportedAgent | null;
  /** The scope as it would be saved. Null is every server. */
  servers: ScopedServer[] | null;
  bundled: BundledServer[];
  /** The rows behind `servers` and `bundled`, for the write. Not part of the preview. */
  rows: { mcpServerIds: string[] | null; servers: NewMcpServer[] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The top-level keys of a spec that end up in a row. `hooks`, `extensions`, `id` and `$schema`
 * are named by the format and dropped for reasons of their own, below; anything else in a
 * document is a key from a later version, carried through by the parser and dropped here.
 */
const READ = new Set([
  "spec",
  "name",
  "description",
  "endpoint",
  "model",
  "prompt",
  "tools",
  "retry",
  "tasks",
  "bundle",
  "requires",
]);
const DROPPED_BY_NAME = new Set(["id", "$schema", "hooks", "extensions"]);

/** The keys of a bundled server that have a column in `mcp_servers`. */
const SERVER_COLUMNS = new Set([
  "id",
  "slug",
  "label",
  "enabled",
  "transport",
  "command",
  "args",
  "env",
  "url",
  "headers",
  "hiddenTools",
  "hooks",
]);

/** The widest whole number an `integer` column holds. */
const MAX_INTEGER = 2_147_483_647;

/**
 * Reads one bundled server into the row creating it would write, and into what a preview says
 * about it.
 *
 * The row goes through `shapeProblems` — the check every MCP server write is put through — and
 * its hooks through the pool's `validateHooks`. The one rule relaxed is this host's own: a hook
 * bound to an event task-server never fires is a note here and is stored as written, where a
 * write through the API would refuse it. The document was written for a host that fires it,
 * and refusing a whole agent over a hook that will simply wait is the wrong trade; an edit to
 * the row afterwards is only refused for what that edit introduces, so the row stays editable.
 *
 * `createByDefault` is the tick a form starts with. A url is dialled and a command is run:
 * offering to dial a server the document names is a reasonable default, and offering to execute
 * a command line out of a file is not, so a stdio server is always one the operator ticks
 * themselves. One that is already here, or could not be saved anyway, is not offered at all.
 */
function readBundled(
  held: SpecServer,
  existing: ReadonlyMap<string, McpServerRow>,
  chosen: ReadonlySet<string>,
): { preview: BundledServer; row: NewMcpServer } {
  // The parser kept this server because it has one or the other, and non-empty.
  const slug = String(held.slug || held.id);
  const transport =
    typeof held.transport === "string" ? held.transport : held.url ? "http" : "stdio";
  const candidate = {
    slug,
    label: held.label ?? "",
    transport,
    command: held.command ?? "",
    args: held.args ?? null,
    env: held.env ?? null,
    url: held.url ?? "",
    headers: held.headers ?? null,
    hiddenTools: held.hiddenTools ?? null,
    hooks: held.hooks ?? null,
    // Created enabled, whatever the document says: the operator ticked it to use it, and the
    // exporting host's switch was a decision about that host.
    enabled: true,
  };

  const hooks = splitHookProblems(candidate.hooks);
  const problems = [...shapeProblems({ ...NEW_MCP_SERVER, ...candidate }), ...hooks.broken];

  const notes = hooks.unfired.map((problem) => `${problem} — kept as written, and never called`);
  for (const key of Object.keys(held)) {
    if (!SERVER_COLUMNS.has(key)) notes.push(`\`${key}\` has no column here, and is not kept`);
  }
  if (held.enabled === false) notes.push("disabled where it was exported; created enabled here");

  const names = (value: unknown) => (isRecord(value) ? Object.keys(value) : []);
  const line = [candidate.command, ...(Array.isArray(candidate.args) ? candidate.args : [])];
  const exists = existing.has(slug);
  const http = transport === "http";

  return {
    preview: {
      slug,
      label: typeof candidate.label === "string" ? candidate.label : "",
      transport,
      target: http ? String(candidate.url) : line.map(String).join(" ").trim(),
      envNames: names(candidate.env),
      headerNames: names(candidate.headers),
      exists,
      create: chosen.has(slug),
      createByDefault: http && !exists && problems.length === 0,
      problems,
      notes,
    },
    // Only handed to an insert once `problems` is empty, which is what makes these the types
    // the columns hold rather than whatever a document put there.
    row: candidate as NewMcpServer,
  };
}

/**
 * Decides what importing a document would do, without doing it.
 *
 * One function answers both the preview and the write, so what the operator was shown is what
 * is saved: the write re-plans inside its transaction and refuses on the same list.
 *
 * `parseSpec` reads the document. Its errors are the reasons a document is not a spec at all
 * and are passed on in its words; its warnings are what it dropped. `understands` is empty, so
 * a document that `requires` an extension is refused — this host implements none. What is
 * added here is the second loss, between a spec and a row: a profile is the columns of `agents`
 * and nothing else, so a field with no column is listed in `dropped` and gone on re-export.
 * That is accepted, and the list is what keeps it from being silent.
 *
 * The scope is where an import could do harm, because the column cannot say "no servers" —
 * empty and null both mean every one. So narrowing never widens:
 *
 * - a slug that is neither here nor being created is dropped from the list with a warning;
 * - a list that is left empty by that, or was written empty, refuses the import — the document
 *   asked for less than everything and would be saved as everything;
 * - a `tools.servers` that is not a list refuses it too, since the parser's answer to that is
 *   to drop the field, which is the same widening by another road.
 *
 * A bundled server is created only when `createServers` names it. Naming one whose slug is
 * already here refuses the import and names the slug: the alternative is choosing between two
 * definitions on the operator's behalf. Left unnamed, the same slug simply means the row that
 * exists.
 *
 * @param document - Parsed JSON, from a file or a paste. Nothing about it is trusted.
 * @param options - What the operator chose.
 * @param existing - Every MCP server row, read by whoever is calling: the preview reads them
 * plainly, and the write inside its transaction.
 */
export function planImport(
  document: unknown,
  options: ImportOptions,
  existing: readonly McpServerRow[],
): ImportPlan {
  const parsed = parseSpec(document, {
    bundle: true,
    events: HOOK_EVENTS_FIRED,
    understands: [],
  });
  const plan: ImportPlan = {
    refusals: [...parsed.errors],
    warnings: [...parsed.warnings],
    dropped: [],
    agent: null,
    servers: null,
    bundled: [],
    rows: { mcpServerIds: null, servers: [] },
  };
  const spec = parsed.spec;
  if (!spec) return plan;

  const drop = (path: string, why: string) => plan.dropped.push(`${path}: ${why}`);

  const name = options.name?.trim() || spec.name?.trim() || "";
  if (!name) plan.refusals.push("name: the document names no agent, so give the profile a name");

  // --- what a profile has no column for -------------------------------------------------------

  if (spec.id !== undefined) drop("id", "a profile here is given an id of its own");
  if (spec.$schema !== undefined) drop("$schema", "is for an editor, and is not kept");
  for (const key of Object.keys(spec)) {
    if (!READ.has(key) && !DROPPED_BY_NAME.has(key)) drop(key, "is not a key this server reads");
  }
  for (const key of Object.keys(spec.extensions ?? {})) {
    drop(`extensions.${key}`, "this server implements no extension");
  }
  for (const [index, hook] of (spec.hooks ?? []).entries()) {
    drop(
      `hooks[${index}]`,
      `"${hook.id}" — a profile has no hooks here; a hook is set on its MCP server's row`,
    );
  }
  if (spec.endpoint?.firstTokenSeconds !== undefined) {
    drop("endpoint.firstTokenSeconds", "the first token is given requestTimeoutSeconds here");
  }
  for (const key of ["reasoningEffort", "contextLength", "extraBody"] as const) {
    if (spec.model?.[key] !== undefined) drop(`model.${key}`, "a profile has no such setting");
  }
  if (spec.retry?.loadingTimeoutSeconds !== undefined) {
    drop("retry.loadingTimeoutSeconds", "a profile has no such setting");
  }
  if (spec.tools?.discovery === "proxy") {
    drop("tools.discovery", '"proxy" is not a mode this server has, so it is left to inherit');
  }
  for (const [task, said] of Object.entries(spec.tasks ?? {})) {
    if (task !== "toolSelect") {
      drop(`tasks.${task}`, "this server runs no such side task");
      continue;
    }
    for (const key of Object.keys(said)) {
      if (key !== "model") drop(`tasks.toolSelect.${key}`, "tool selection takes a model only");
    }
  }

  // A profile holds one prompt. Parts with a text are joined in the document's order; a part
  // that is only a reference has nothing to join, since nothing here reads a file or a url.
  const texts: string[] = [];
  for (const [index, part] of (spec.prompt ?? []).entries()) {
    if (part.ref) drop(`prompt[${index}].ref`, "a reference is not followed here");
    if (part.text === "") {
      drop(`prompt[${index}]`, "an empty part deletes the one below it, which a row cannot say");
    } else if (part.text !== undefined) {
      texts.push(part.text);
      if (part.id !== "system") {
        drop(`prompt[${index}].id`, `"${part.id}" — the one prompt a profile holds is "system"`);
      }
    }
  }
  if (texts.length > 1) {
    plan.warnings.push(
      `prompt: ${texts.length} parts are joined into the one system prompt a profile holds`,
    );
  }

  // The integer columns hold whole numbers, and the parser has only promised a finite one in
  // range. A value that would fail the insert is dropped here instead, with the reason.
  const whole = (path: string, value: number | undefined) => {
    if (value === undefined) return -1;
    if (Number.isInteger(value) && value <= MAX_INTEGER) return value;
    drop(path, `${value} is not a whole number this column can hold, so it is left to inherit`);
    return -1;
  };

  const discovery = spec.tools?.discovery;
  plan.agent = {
    name,
    description: spec.description ?? "",
    baseUrl: spec.endpoint?.baseUrl?.trim() ?? "",
    model: spec.model?.model?.trim() ?? "",
    systemPrompt: texts.join("\n\n"),
    maxTokens: whole("model.maxTokens", spec.model?.maxTokens),
    temperature: spec.model?.temperature ?? -1,
    maxToolIterations: whole("tools.maxIterations", spec.tools?.maxIterations),
    toolDiscovery: discovery === "eager" || discovery === "ondemand" ? discovery : "inherit",
    toolSelectModel: spec.tasks?.toolSelect?.model?.trim() ?? "",
    requestTimeoutSeconds: whole(
      "endpoint.requestTimeoutSeconds",
      spec.endpoint?.requestTimeoutSeconds,
    ),
    maxRetries: whole("retry.maxRetries", spec.retry?.maxRetries),
  };
  if (plan.agent.baseUrl) {
    plan.warnings.push(
      "endpoint.baseUrl: the profile names an endpoint of its own and a spec carries no key, " +
        "so it sends none until one is set on the profile",
    );
  }

  // --- the bundle, and which of it the operator asked for -------------------------------------

  const bySlug = new Map(existing.map((row) => [row.slug, row]));
  const chosen = new Set(options.createServers ?? []);
  const created = new Map<string, NewMcpServer & { id: string }>();

  for (const held of spec.bundle?.mcpServers ?? []) {
    const { preview, row } = readBundled(held, bySlug, chosen);
    plan.bundled.push(preview);
    if (!preview.create) continue;
    if (preview.exists) {
      plan.refusals.push(
        `bundle: "${preview.slug}" is already an MCP server here, and an import does not ` +
          "overwrite one. Leave it unticked to use the one that exists.",
      );
    } else if (preview.problems.length) {
      plan.refusals.push(
        `bundle: "${preview.slug}" cannot be saved as written: ${preview.problems.join("; ")}`,
      );
    } else {
      created.set(preview.slug, { ...row, id: crypto.randomUUID() });
    }
  }
  for (const slug of chosen) {
    if (!plan.bundled.some((server) => server.slug === slug)) {
      plan.refusals.push(`bundle: "${slug}" is not a server this document bundles`);
    }
  }
  plan.rows.servers = [...created.values()];

  // --- the scope ------------------------------------------------------------------------------

  const tools = isRecord(document) ? document.tools : undefined;
  const written = isRecord(tools) ? tools.servers : undefined;
  if (written !== undefined && written !== null && !Array.isArray(written)) {
    plan.refusals.push(
      "tools.servers: is not a list of slugs, and dropping it would give the profile every " +
        "server here rather than the ones it was narrowed to",
    );
    return plan;
  }
  const asked = spec.tools?.servers;
  // Absent is every server in a spec and in the column alike, so there is nothing to resolve.
  if (asked === undefined) return plan;

  const scoped: ScopedServer[] = [];
  const ids: string[] = [];
  const missing: string[] = [];
  for (const slug of new Set(asked)) {
    const made = created.get(slug);
    const found = bySlug.get(slug);
    if (made) {
      scoped.push({ slug, label: made.label ?? "", created: true });
      ids.push(made.id);
    } else if (found) {
      scoped.push({ slug, label: found.label, created: false });
      ids.push(found.id);
      if (!found.enabled) {
        plan.warnings.push(
          `tools.servers: "${slug}" is disabled here, so a run reaches nothing on it`,
        );
      }
    } else {
      missing.push(slug);
      const offered = plan.bundled.some((server) => server.slug === slug);
      plan.warnings.push(
        `tools.servers: "${slug}" is not an MCP server here, and was dropped from the profile's ` +
          `servers${offered ? " — the document bundles it, and it can be created" : ""}`,
      );
      drop("tools.servers", `"${slug}" is not an MCP server here`);
    }
  }

  if (ids.length === 0) {
    plan.refusals.push(
      missing.length === 0
        ? "tools.servers: the document gives this agent no servers at all, and a profile here " +
            "cannot say that — an empty list is every server"
        : `tools.servers: none of the servers this agent is narrowed to exist here ` +
            `(${missing.join(", ")}), and a profile with none listed reaches every server. ` +
            "Create them first, or create the bundled ones with the import.",
    );
    return plan;
  }
  plan.servers = scoped;
  plan.rows.mcpServerIds = ids;
  return plan;
}

/** The `agentSpecPreview` query: what `importAgentSpec` would do with the same arguments. */
export async function previewImport(document: unknown, options: ImportOptions) {
  return planImport(document, options, await db.select().from(mcpServers));
}

/**
 * The `importAgentSpec` mutation: one profile, and the bundled servers the operator named, or
 * nothing at all.
 *
 * Planned again inside the transaction rather than trusted from a preview — the preview was a
 * read, and a server may have been added under one of these slugs since. The unique index on
 * `slug` is the backstop for the two imports that race past that.
 *
 * The profile is saved with no key: a spec has nowhere to carry one, and `setAgentApiKey` is
 * the only door a key comes in through.
 */
export async function importAgent(document: unknown, options: ImportOptions): Promise<Agent> {
  const { agent, made } = await db.transaction(async (tx) => {
    const plan = planImport(document, options, await tx.select().from(mcpServers));
    if (plan.refusals.length || !plan.agent) {
      throw new GraphQLError(`This agent spec cannot be imported: ${plan.refusals.join("; ")}`, {
        extensions: { code: "BAD_AGENT_SPEC", problems: plan.refusals },
      });
    }
    if (plan.rows.servers.length) await tx.insert(mcpServers).values(plan.rows.servers);
    const [row] = await tx
      .insert(agents)
      .values({ ...plan.agent, mcpServerIds: plan.rows.mcpServerIds })
      .returning();
    return { agent: row, made: plan.rows.servers.length };
  });
  // A hand-written write goes round the `onWrite` hook that reconciles the pool, so it says so
  // itself — once the rows are committed, or the pool would read the table from before them.
  if (made) mcp.syncSoon();
  return agent;
}
