import { db } from "./client.ts";

/** Adds a column unless it is already there. SQLite has no `ADD COLUMN IF NOT EXISTS`. */
function addColumn(table: string, column: string, definition: string) {
  try {
    db.$client.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (!/duplicate column/i.test((error as Error).message)) throw error;
  }
}

/** The SQLite half of `ensureSchema()`. Synchronous, like the driver under it. */
export function ensureSqliteTables() {
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
      maxToolIterations INTEGER NOT NULL DEFAULT 20,
      toolDiscovery TEXT NOT NULL DEFAULT 'eager',
      toolSelectModel TEXT NOT NULL DEFAULT ''
    );
  `);

  // Columns added after a database was first created: `CREATE TABLE IF NOT EXISTS` above
  // does nothing for a file that already exists, so each addition is also an ALTER whose
  // "duplicate column" complaint is the expected outcome on every boot but the first.
  addColumn("settings", "toolDiscovery", "TEXT NOT NULL DEFAULT 'eager'");
  addColumn("settings", "toolSelectModel", "TEXT NOT NULL DEFAULT ''");
}
