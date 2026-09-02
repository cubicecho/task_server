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
 * The whole domain, in one place. Postgres is the only database; `client.ts` chooses which
 * postgres — embedded or a server — and nothing above this directory has to care.
 *
 * A **task** is a prompt plus the model settings to run it with, a
 * **trigger** is a reason to run it, a **step** is something that happens after the prompt,
 * and a **run** is one execution with its output.
 *
 * Triggers are deliberately a separate table rather than a `cron` column on the task. Cron is
 * the only kind that fires today, but the point of the split is that "when a new email arrives"
 * is a second row against the same task, not a second column on every task that will never use
 * it. `kind` discriminates; `cron`/`timezone` belong to cron rows and `event`/`config` to event
 * rows, which is why both sets are nullable.
 *
 * Column names stay camelCase. Postgres folds unquoted identifiers to lower case, so the
 * generated migrations under `drizzle/` quote every one of them. This file is the only
 * definition of the tables: change it, then `npm run db:generate` to write the migration that
 * gets the change into a database.
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
  /** What the agent is asked to do, each time this task fires. */
  prompt: text().notNull(),
  /** Empty falls back to the default model in settings. */
  model: text().notNull().default(""),
  /** Empty falls back to the default system prompt in settings. */
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
    /** `cron` fires on a schedule. `event` fires when `POST /webhooks/<event>` arrives. */
    kind: text({ enum: ["cron", "event"] })
      .notNull()
      .default("cron"),
    /** Cron expression, for `kind: "cron"`. */
    cron: text().notNull().default(""),
    /** IANA zone the expression is read in. Empty means the server's own zone. */
    timezone: text().notNull().default(""),
    /**
     * The webhook id, for `kind: "event"`. `POST /webhooks/<this>` runs the task.
     *
     * It is the whole of the address: any id is accepted by the route, and one that no trigger
     * is listening for is answered and dropped. Pick something unguessable if the server is
     * reachable by anyone you would rather not have firing your tasks.
     */
    event: text().notNull().default(""),
    /** Free-form JSON for the event's matching rules. Opaque to the server for now. */
    config: jsonb().$type<Record<string, unknown>>(),
    enabled: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index("triggers_task_idx").on(table.taskId)],
);

/**
 * What happens after the task's own prompt.
 *
 * A task's prompt is still the first thing that runs; these are the steps that follow it, and
 * they form a tree rather than a list because a `decision` step picks which of its arms runs
 * next — the `choose` action of a home-automation rule. A step's place in that tree is
 * `parentId` (the decision it hangs off, null at the top level), `branch` (which arm of that
 * decision) and `position` (where in its arm).
 *
 * `parentId` is a real self-referencing foreign key so deleting a decision takes its whole
 * subtree with it. It is deliberately *not* declared as a relation below: nothing needs to walk
 * it one level at a time, and both the runner and the editor would rather have the flat list
 * and build the tree themselves.
 */
export const steps = pgTable(
  "steps",
  {
    id: id(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** The decision this step hangs off. Null means the task's own top-level sequence. */
    parentId: text().references((): AnyPgColumn => steps.id, { onDelete: "cascade" }),
    /** Which arm of the parent decision this sits in. Empty at the top level. */
    branch: text().notNull().default(""),
    /** Where in its sequence this step runs. */
    position: integer().notNull().default(0),
    /** `agent` does the work. `decision` does the work *and* picks the arm to run next. */
    kind: text({ enum: ["agent", "decision"] })
      .notNull()
      .default("agent"),
    /** What this step is called, in the run history and in `{{steps.<name>}}`. */
    name: text().notNull().default(""),
    prompt: text().notNull().default(""),
    /** Decision only: the arms it may choose between. `default` is always available. */
    cases: jsonb().$type<string[]>(),
    /** Empty falls back to the task's model, then to settings. */
    model: text().notNull().default(""),
    systemPrompt: text().notNull().default(""),
    /** How much of the run so far this step is shown before its own prompt. */
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
    /** Null for a run started by hand from the UI. */
    triggerId: text().references(() => triggers.id, { onDelete: "set null" }),
    /**
     * `stopped` is a run called off by hand — not a failure, and not a result either.
     *
     * `skipped` is a trigger that fired at a task already running. Nothing executed, so there
     * is nothing to report but the reason, which is in `error`. It is a row rather than a log
     * line because a delivery that quietly does nothing is the one thing a webhook's sender
     * cannot see, and the run history is where someone goes to look.
     */
    status: text({ enum: ["running", "ok", "error", "stopped", "skipped"] })
      .notNull()
      .default("running"),
    startedAt: createdAt(),
    finishedAt: timestamp({ mode: "date", withTimezone: true }),
    /** The agent's final reply. */
    output: text().notNull().default(""),
    error: text().notNull().default(""),
    /** Every tool the run called, in order, as JSON — enough to see what it actually did. */
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

/**
 * One step of one run: the path a run actually took through the task's tree.
 *
 * The run row says what came out at the end; this says how it got there — which steps ran, in
 * what order, and at each decision which way it went. That last column is usually the reason
 * someone opens a run at all.
 *
 * The rendered input is deliberately absent: it is the earlier steps' outputs, which are
 * already here, and storing it again would double what a run costs on disk.
 */
export const runSteps = pgTable(
  "run_steps",
  {
    id: id(),
    runId: text()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** Null once the step it came from has been edited away — the run's account still stands. */
    stepId: text().references(() => steps.id, { onDelete: "set null" }),
    /** Execution order within the run, from 0. */
    position: integer().notNull().default(0),
    /** How deep in the tree this ran, so the history can be indented the way the task is. */
    depth: integer().notNull().default(0),
    /** The step's name when it ran; the step itself may since have been renamed or deleted. */
    name: text().notNull().default(""),
    kind: text().notNull().default("agent"),
    /** `skipped` is a disabled step, which is neither a success nor a failure. */
    status: text({ enum: ["running", "ok", "error", "stopped", "skipped"] })
      .notNull()
      .default("running"),
    /** Decision only: the arm it took. */
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
  /** Namespace for this server's tools: the agent sees `<slug>__<tool name>`. */
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

/** One row, `id: "default"`. A table rather than a file so it comes free over GraphQL. */
export const settings = pgTable("settings", {
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
  /**
   * `eager` sends every MCP tool definition on every request. `ondemand` sends a name-only
   * catalogue and lets the model load the schemas it needs — far cheaper with many tools,
   * at the cost of a round trip on the runs that use them.
   */
  toolDiscovery: text({ enum: ["eager", "ondemand"] })
    .notNull()
    .default("eager"),
  /** Small model that guesses a run's tools before it starts. Empty uses the task's model. */
  toolSelectModel: text().notNull().default(""),
  /**
   * How long a finished run is kept, in days. Zero — the default — keeps every run forever.
   *
   * A run row holds the whole output and error text, so a task on a five-minute cron writes
   * something over a hundred thousand of them a year. This is the ceiling on that. See
   * `scheduler/cleanup.ts`.
   */
  runRetentionDays: integer().notNull().default(0),
  /**
   * Seconds of silence from the model endpoint before a request is given up on.
   *
   * Silence, not total duration: the clock resets on every chunk, so a long answer is never
   * cut off halfway and an endpoint that has stopped talking does not hang the run forever.
   */
  requestTimeoutSeconds: integer().notNull().default(120),
  /**
   * How many times a request that failed *before producing anything* is tried again.
   *
   * Only that case is safe to retry — see `runner/agent.ts`. Zero turns retries off.
   */
  maxRetries: integer().notNull().default(2),
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
  // `steps.parentId` is a foreign key but not a relation: see the table's own note.
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

export type Task = typeof tasks.$inferSelect;
export type Trigger = typeof triggers.$inferSelect;
export type Step = typeof steps.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunStep = typeof runSteps.$inferSelect;
export type McpServerRow = typeof mcpServers.$inferSelect;
export type Settings = typeof settings.$inferSelect;
