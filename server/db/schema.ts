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
 * What each column *means* is not here: it is in `graphql/docs.ts`, which puts it on the
 * generated schema, so the one sentence reaches an agent reading a tool schema and a person
 * reading the form as well as anyone reading this file. Comments that survive here are the ones
 * that explain why a column exists or why it is shaped this way — the part no field description
 * has room for.
 *
 * Triggers are deliberately a separate table rather than a `cron` column on the task. Cron is
 * the only kind that fires today, but the point of the split is that "when a new email arrives"
 * is a second row against the same task, not a second column on every task that will never use
 * it. `kind` discriminates; `cron`/`timezone` belong to cron rows and `event` to event rows,
 * which is why both sets are nullable.
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
    /**
     * Any id is accepted by the route, and one that no trigger is listening for is answered and
     * dropped — so an unanswered delivery and a wrong id look the same from outside.
     */
    event: text().notNull().default(""),
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
    /**
     * A `skipped` firing is a row rather than a log line because a delivery that quietly does
     * nothing is the one thing a webhook's sender cannot see, and the run history is where
     * someone goes to look.
     *
     * `queued` is the same row before it has run: a trigger fired at a server with no slot free,
     * and the work is waiting rather than lost. It becomes `running` when a slot comes back — the
     * same row, so the id a webhook was told is the id that eventually holds the output.
     */
    status: text({ enum: ["queued", "running", "ok", "error", "stopped", "skipped"] })
      .notNull()
      .default("running"),
    startedAt: createdAt(),
    finishedAt: timestamp({ mode: "date", withTimezone: true }),
    /**
     * Kept because a run's account of itself is otherwise incomplete — the prompt the agent saw
     * depended on this. A cron tick carries no information beyond having happened, and neither
     * does the play button, so only an `event` trigger ever fills it in; a body that would not
     * parse as JSON is a delivery with no payload, not a failed one.
     */
    payload: jsonb().$type<unknown>(),
    /**
     * A skip is a fact about a pair — this trigger fired while that run was going — so it is
     * recorded against the run it collided with, and a second delivery into the same collision
     * bumps `attempts` rather than writing another row. Without that, a webhook posted every
     * second at a task that takes five minutes writes three hundred rows saying one thing.
     */
    blockedBy: text().references((): AnyPgColumn => runs.id, { onDelete: "set null" }),
    attempts: integer().notNull().default(1),
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

/** One row, `id: "default"`. A table rather than a file so it comes free over GraphQL. */
export const settings = pgTable("settings", {
  id: text().primaryKey().default("default"),
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
  maxToolIterations: integer().notNull().default(20),
  toolDiscovery: text({ enum: ["eager", "ondemand"] })
    .notNull()
    .default("eager"),
  toolSelectModel: text().notNull().default(""),
  /**
   * A run row holds the whole output and error text, so a task on a five-minute cron writes
   * something over a hundred thousand of them a year. This is the ceiling on that. See
   * `scheduler/cleanup.ts`.
   */
  runRetentionDays: integer().notNull().default(0),
  requestTimeoutSeconds: integer().notNull().default(120),
  /** Only a failure before the first chunk is safe to retry — see `runner/agent.ts`. */
  maxRetries: integer().notNull().default(2),
  /**
   * How many runs may be in flight at once, across every task.
   *
   * A task is already serialised against itself; this is the other pile-up, the one where a
   * dozen unrelated triggers share a midnight and the endpoint gets a dozen concurrent streams
   * with every MCP server's tools attached to each. Four is a number that survives that without
   * getting in the way of a handful of tasks, and it is meant to be changed. Zero lifts the
   * limit entirely, which is what this did before the column existed.
   *
   * A firing that arrives with no slot free is turned away exactly as one that meets its own
   * task already running is — a `skipped` run saying so, not a silence. See `runner/run.ts`.
   */
  maxConcurrentRuns: integer().notNull().default(4),
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
