import { defineRelations } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * The same tables as `schema.sqlite.ts`, in `pg-core`. What each column is *for* is written
 * there and only there; this file is the translation, and `tests/schema-parity.test.ts` fails
 * if it stops matching.
 *
 * Four columns change shape rather than name: a SQLite `integer` boolean becomes `boolean`, a
 * `timestamp_ms` integer becomes `timestamp with time zone`, and JSON held as `text` becomes
 * `jsonb`. Every one of them reads back into JavaScript as the same value it did before —
 * which is why the rest of the server can be written against the SQLite types alone.
 *
 * Column names stay camelCase, as they are in SQLite, so one set of DDL names serves both.
 * Postgres folds unquoted identifiers to lower case, so `ensure.pg.ts` quotes all of them.
 */

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  timestamp({ mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date());

export const tasks = pgTable("tasks", {
  id: id(),
  name: text().notNull(),
  prompt: text().notNull(),
  model: text().notNull().default(""),
  systemPrompt: text().notNull().default(""),
  enabled: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: timestamp({ mode: "date", withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

export const triggers = pgTable(
  "triggers",
  {
    id: id(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    kind: text({ enum: ["cron", "event"] })
      .notNull()
      .default("cron"),
    cron: text().notNull().default(""),
    timezone: text().notNull().default(""),
    event: text().notNull().default(""),
    config: jsonb().$type<Record<string, unknown>>(),
    enabled: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index("triggers_task_idx").on(table.taskId)],
);

export const steps = pgTable(
  "steps",
  {
    id: id(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    parentId: text().references((): AnyPgColumn => steps.id, { onDelete: "cascade" }),
    branch: text().notNull().default(""),
    position: integer().notNull().default(0),
    kind: text({ enum: ["agent", "decision"] })
      .notNull()
      .default("agent"),
    name: text().notNull().default(""),
    prompt: text().notNull().default(""),
    cases: jsonb().$type<string[]>(),
    model: text().notNull().default(""),
    systemPrompt: text().notNull().default(""),
    context: text({ enum: ["all", "previous", "none"] })
      .notNull()
      .default("all"),
    enabled: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    index("steps_task_idx").on(table.taskId),
    index("steps_parent_idx").on(table.parentId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: id(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    triggerId: text().references(() => triggers.id, { onDelete: "set null" }),
    status: text({ enum: ["running", "ok", "error", "stopped"] })
      .notNull()
      .default("running"),
    startedAt: createdAt(),
    finishedAt: timestamp({ mode: "date", withTimezone: true }),
    output: text().notNull().default(""),
    error: text().notNull().default(""),
    toolCalls: jsonb().$type<{ name: string; ok: boolean }[]>(),
    promptTokens: integer().notNull().default(0),
    completionTokens: integer().notNull().default(0),
    totalTokens: integer().notNull().default(0),
  },
  (table) => [
    index("runs_task_idx").on(table.taskId),
    index("runs_started_idx").on(table.startedAt),
  ],
);

export const runSteps = pgTable(
  "run_steps",
  {
    id: id(),
    runId: text()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stepId: text().references(() => steps.id, { onDelete: "set null" }),
    position: integer().notNull().default(0),
    depth: integer().notNull().default(0),
    name: text().notNull().default(""),
    kind: text().notNull().default("agent"),
    status: text({ enum: ["running", "ok", "error", "stopped", "skipped"] })
      .notNull()
      .default("running"),
    branch: text().notNull().default(""),
    startedAt: createdAt(),
    finishedAt: timestamp({ mode: "date", withTimezone: true }),
    output: text().notNull().default(""),
    error: text().notNull().default(""),
    toolCalls: jsonb().$type<{ name: string; ok: boolean }[]>(),
    promptTokens: integer().notNull().default(0),
    completionTokens: integer().notNull().default(0),
    totalTokens: integer().notNull().default(0),
  },
  (table) => [index("run_steps_run_idx").on(table.runId)],
);

export const mcpServers = pgTable("mcp_servers", {
  id: id(),
  slug: text().notNull().unique(),
  label: text().notNull().default(""),
  enabled: boolean().notNull().default(true),
  transport: text({ enum: ["stdio", "http"] })
    .notNull()
    .default("stdio"),
  command: text().notNull().default(""),
  args: jsonb().$type<string[]>(),
  env: jsonb().$type<Record<string, string>>(),
  url: text().notNull().default(""),
  headers: jsonb().$type<Record<string, string>>(),
});

export const settings = pgTable("settings", {
  id: text().primaryKey().default("default"),
  baseUrl: text().notNull().default("http://localhost:11434/v1"),
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
  maxToolIterations: integer().notNull().default(20),
  toolDiscovery: text({ enum: ["eager", "ondemand"] })
    .notNull()
    .default("eager"),
  toolSelectModel: text().notNull().default(""),
});

export const schema = { tasks, triggers, steps, runs, runSteps, mcpServers, settings };

export const relations = defineRelations(schema, (r) => ({
  tasks: {
    triggers: r.many.triggers({ from: r.tasks.id, to: r.triggers.taskId }),
    steps: r.many.steps({ from: r.tasks.id, to: r.steps.taskId }),
    runs: r.many.runs({ from: r.tasks.id, to: r.runs.taskId }),
  },
  triggers: {
    task: r.one.tasks({ from: r.triggers.taskId, to: r.tasks.id, optional: false }),
    runs: r.many.runs({ from: r.triggers.id, to: r.runs.triggerId }),
  },
  steps: {
    task: r.one.tasks({ from: r.steps.taskId, to: r.tasks.id, optional: false }),
  },
  runs: {
    task: r.one.tasks({ from: r.runs.taskId, to: r.tasks.id, optional: false }),
    trigger: r.one.triggers({ from: r.runs.triggerId, to: r.triggers.id }),
    steps: r.many.runSteps({ from: r.runs.id, to: r.runSteps.runId }),
  },
  runSteps: {
    run: r.one.runs({ from: r.runSteps.runId, to: r.runs.id, optional: false }),
  },
}));
