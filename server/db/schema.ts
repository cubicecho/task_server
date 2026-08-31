import { defineRelations } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The whole domain: a **task** is a prompt plus the model settings to run it with, a
 * **trigger** is a reason to run it, and a **run** is one execution with its output.
 *
 * Triggers are deliberately a separate table rather than a `cron` column on the task. Cron is
 * the only kind that fires today, but the point of the split is that "when a new email arrives"
 * is a second row against the same task, not a second column on every task that will never use
 * it. `kind` discriminates; `cron`/`timezone` belong to cron rows and `event`/`config` to event
 * rows, which is why both sets are nullable.
 */

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const tasks = sqliteTable("tasks", {
  id: id(),
  name: text().notNull(),
  /** What the agent is asked to do, each time this task fires. */
  prompt: text().notNull(),
  /** Empty falls back to the default model in settings. */
  model: text().notNull().default(""),
  /** Empty falls back to the default system prompt in settings. */
  systemPrompt: text().notNull().default(""),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

export const triggers = sqliteTable(
  "triggers",
  {
    id: id(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** `cron` fires on a schedule. `event` is the seam for inbound events; nothing fires it yet. */
    kind: text({ enum: ["cron", "event"] })
      .notNull()
      .default("cron"),
    /** Cron expression, for `kind: "cron"`. */
    cron: text().notNull().default(""),
    /** IANA zone the expression is read in. Empty means the server's own zone. */
    timezone: text().notNull().default(""),
    /** Event name, for `kind: "event"` — e.g. `email.received`. */
    event: text().notNull().default(""),
    /** Free-form JSON for the event's matching rules. Opaque to the server for now. */
    config: text({ mode: "json" }).$type<Record<string, unknown>>(),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index("triggers_task_idx").on(table.taskId)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: id(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** Null for a run started by hand from the UI. */
    triggerId: text().references(() => triggers.id, { onDelete: "set null" }),
    status: text({ enum: ["running", "ok", "error"] })
      .notNull()
      .default("running"),
    startedAt: createdAt(),
    finishedAt: integer({ mode: "timestamp_ms" }),
    /** The agent's final reply. */
    output: text().notNull().default(""),
    error: text().notNull().default(""),
    /** Every tool the run called, in order, as JSON — enough to see what it actually did. */
    toolCalls: text({ mode: "json" }).$type<{ name: string; ok: boolean }[]>(),
    promptTokens: integer().notNull().default(0),
    completionTokens: integer().notNull().default(0),
    totalTokens: integer().notNull().default(0),
  },
  (table) => [
    index("runs_task_idx").on(table.taskId),
    index("runs_started_idx").on(table.startedAt),
  ],
);

export const mcpServers = sqliteTable("mcp_servers", {
  id: id(),
  /** Namespace for this server's tools: the agent sees `<slug>__<tool name>`. */
  slug: text().notNull().unique(),
  label: text().notNull().default(""),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  transport: text({ enum: ["stdio", "http"] })
    .notNull()
    .default("stdio"),
  command: text().notNull().default(""),
  args: text({ mode: "json" }).$type<string[]>(),
  env: text({ mode: "json" }).$type<Record<string, string>>(),
  url: text().notNull().default(""),
  headers: text({ mode: "json" }).$type<Record<string, string>>(),
});

/** One row, `id: "default"`. A table rather than a file so it comes free over GraphQL. */
export const settings = sqliteTable("settings", {
  id: text().primaryKey().default("default"),
  /** Any OpenAI-compatible endpoint: OpenAI, Ollama, LM Studio, vLLM, OpenRouter, ... */
  baseUrl: text().notNull().default("http://localhost:11434/v1"),
  /** Empty falls back to $OPENAI_API_KEY. */
  apiKey: text().notNull().default(""),
  model: text().notNull().default(""),
  systemPrompt: text()
    .notNull()
    .default(
      "You are a task runner. Carry out the instruction using the tools available to you, " +
        "then report what you did and what you found. Say plainly when something failed.",
    ),
  maxTokens: integer().notNull().default(4096),
  temperature: real().notNull().default(0.7),
  /** Ceiling on tool round-trips in one run, so a stuck task cannot loop forever. */
  maxToolIterations: integer().notNull().default(20),
});

export const schema = { tasks, triggers, runs, mcpServers, settings };

export const relations = defineRelations(schema, (r) => ({
  tasks: {
    triggers: r.many.triggers({ from: r.tasks.id, to: r.triggers.taskId }),
    runs: r.many.runs({ from: r.tasks.id, to: r.runs.taskId }),
  },
  triggers: {
    task: r.one.tasks({ from: r.triggers.taskId, to: r.tasks.id, optional: false }),
    runs: r.many.runs({ from: r.triggers.id, to: r.runs.triggerId }),
  },
  runs: {
    task: r.one.tasks({ from: r.runs.taskId, to: r.tasks.id, optional: false }),
    trigger: r.one.triggers({ from: r.runs.triggerId, to: r.triggers.id }),
  },
}));

export type Task = typeof tasks.$inferSelect;
export type Trigger = typeof triggers.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type McpServerRow = typeof mcpServers.$inferSelect;
export type Settings = typeof settings.$inferSelect;
