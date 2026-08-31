import { pool } from "./client.ts";

/**
 * The postgres half of `ensureSchema()`, statement for statement the same tables as
 * `ensure.sqlite.ts`.
 *
 * The camelCase column names are quoted because postgres folds unquoted identifiers to lower
 * case, and `schema.pg.ts` — like `schema.sqlite.ts` — names them as they are written in
 * TypeScript. `ADD COLUMN IF NOT EXISTS` is real here, so the later additions need none of
 * SQLite's catch-and-ignore.
 *
 * One `query` with several statements rather than one apiece: node-postgres sends an
 * unparameterised query over the simple protocol, which runs the lot in a single implicit
 * transaction — so a boot that fails halfway leaves no half-made schema behind.
 */
export async function ensurePgTables() {
  if (!pool) throw new Error("ensurePgTables() called without a postgres pool");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      "systemPrompt" TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      "createdAt" TIMESTAMPTZ NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY NOT NULL,
      "taskId" TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'cron',
      cron TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT '',
      event TEXT NOT NULL DEFAULT '',
      config JSONB,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      "createdAt" TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS triggers_task_idx ON triggers ("taskId");

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY NOT NULL,
      "taskId" TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      "triggerId" TEXT REFERENCES triggers(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'running',
      "startedAt" TIMESTAMPTZ NOT NULL,
      "finishedAt" TIMESTAMPTZ,
      output TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      "toolCalls" JSONB,
      "promptTokens" INTEGER NOT NULL DEFAULT 0,
      "completionTokens" INTEGER NOT NULL DEFAULT 0,
      "totalTokens" INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS runs_task_idx ON runs ("taskId");
    CREATE INDEX IF NOT EXISTS runs_started_idx ON runs ("startedAt");

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      transport TEXT NOT NULL DEFAULT 'stdio',
      command TEXT NOT NULL DEFAULT '',
      args JSONB,
      env JSONB,
      url TEXT NOT NULL DEFAULT '',
      headers JSONB
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      "baseUrl" TEXT NOT NULL DEFAULT 'http://localhost:11434/v1',
      "apiKey" TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      "systemPrompt" TEXT NOT NULL DEFAULT '',
      "maxTokens" INTEGER NOT NULL DEFAULT 4096,
      temperature REAL NOT NULL DEFAULT 0.7,
      "maxToolIterations" INTEGER NOT NULL DEFAULT 20,
      "toolDiscovery" TEXT NOT NULL DEFAULT 'eager',
      "toolSelectModel" TEXT NOT NULL DEFAULT ''
    );

    ALTER TABLE settings ADD COLUMN IF NOT EXISTS "toolDiscovery" TEXT NOT NULL DEFAULT 'eager';
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS "toolSelectModel" TEXT NOT NULL DEFAULT '';
  `);
}
