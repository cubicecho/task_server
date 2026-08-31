import { sql } from "drizzle-orm";
import { db } from "./client.ts";

/**
 * Creates the tables on boot, so a fresh clone runs with no migration step.
 *
 * This is the MVP's substitute for migrations, not a replacement for them: it only ever
 * *adds*, so a column that changes shape needs `npm run db:push` (drizzle-kit) against the
 * file. Once the schema stops moving, generated migrations replace this outright.
 */
export function ensureSchema() {
  db.$client.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      systemPrompt TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY NOT NULL,
      taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'cron',
      cron TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT '',
      event TEXT NOT NULL DEFAULT '',
      config TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS triggers_task_idx ON triggers (taskId);

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY NOT NULL,
      taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      triggerId TEXT REFERENCES triggers(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'running',
      startedAt INTEGER NOT NULL,
      finishedAt INTEGER,
      output TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      toolCalls TEXT,
      promptTokens INTEGER NOT NULL DEFAULT 0,
      completionTokens INTEGER NOT NULL DEFAULT 0,
      totalTokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS runs_task_idx ON runs (taskId);
    CREATE INDEX IF NOT EXISTS runs_started_idx ON runs (startedAt);

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      transport TEXT NOT NULL DEFAULT 'stdio',
      command TEXT NOT NULL DEFAULT '',
      args TEXT,
      env TEXT,
      url TEXT NOT NULL DEFAULT '',
      headers TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      baseUrl TEXT NOT NULL DEFAULT 'http://localhost:11434/v1',
      apiKey TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      systemPrompt TEXT NOT NULL DEFAULT '',
      maxTokens INTEGER NOT NULL DEFAULT 4096,
      temperature REAL NOT NULL DEFAULT 0.7,
      maxToolIterations INTEGER NOT NULL DEFAULT 20
    );
  `);

  // The settings row is a singleton the UI edits in place, so it has to exist before the UI
  // can load. Column defaults fill the rest in.
  db.$client
    .prepare("INSERT OR IGNORE INTO settings (id, systemPrompt) VALUES ('default', ?)")
    .run(
      "You are a task runner. Carry out the instruction using the tools available to you, " +
        "then report what you did and what you found. Say plainly when something failed.",
    );

  // A run left `running` by a crash is never going to finish; nothing would ever clear it.
  db.run(
    sql`UPDATE runs SET status = 'error', error = 'interrupted by a server restart', finishedAt = ${Date.now()} WHERE status = 'running'`,
  );
}
