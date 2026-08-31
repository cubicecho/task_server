import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { isPostgres } from "./dialect.ts";
import { ensurePgTables } from "./ensure.pg.ts";
import { ensureSqliteTables } from "./ensure.sqlite.ts";
import { runSteps, runs, settings } from "./schema.ts";

const DEFAULT_SYSTEM_PROMPT =
  "You are a task runner. Carry out the instruction using the tools available to you, " +
  "then report what you did and what you found. Say plainly when something failed.";

/**
 * Creates the tables on boot, so a fresh clone — or a fresh postgres database — runs with no
 * migration step.
 *
 * This is the MVP's substitute for migrations, not a replacement for them: it only ever
 * *adds*, so a column that changes shape needs `npm run db:push` (drizzle-kit) against the
 * database. Once the schema stops moving, generated migrations replace this outright.
 *
 * The DDL is per dialect and lives in `ensure.sqlite.ts` / `ensure.pg.ts`. What follows it is
 * not: all three writes are ordinary drizzle ones, and run the same either way.
 */
export async function ensureSchema() {
  if (isPostgres) await ensurePgTables();
  else ensureSqliteTables();

  // The settings row is a singleton the UI edits in place, so it has to exist before the UI
  // can load. Column defaults fill the rest in.
  await db
    .insert(settings)
    .values({ id: "default", systemPrompt: DEFAULT_SYSTEM_PROMPT })
    .onConflictDoNothing();

  // A run left `running` by a crash is never going to finish; nothing would ever clear it. The
  // step it died inside is in the same position, and a run whose steps still say `running`
  // would read as though part of it were somehow still going.
  const interrupted = {
    status: "error",
    error: "interrupted by a server restart",
    finishedAt: new Date(),
  } as const;
  await db.update(runSteps).set(interrupted).where(eq(runSteps.status, "running"));
  await db.update(runs).set(interrupted).where(eq(runs.status, "running"));
}
