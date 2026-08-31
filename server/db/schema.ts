import { isPostgres } from "./dialect.ts";
import * as pg from "./schema.pg.ts";
import * as sqlite from "./schema.sqlite.ts";

/**
 * The tables, in whichever dialect `DATABASE_URL` asked for. Everything above this directory
 * imports from here and never learns which one it got.
 *
 * The postgres tables are handed out under the SQLite tables' *types*. That is the one piece
 * of sleight of hand in the swap, and it is safe for a specific reason: the two schemas differ
 * only in storage. `boolean` and an integer 0/1, `timestamptz` and epoch milliseconds, `jsonb`
 * and JSON in a `text` column — each pair is the same JavaScript value by the time drizzle
 * hands it back, so `Task` describes a row from either database. What the cast buys is that
 * the runner, the GraphQL layer and the tests are written once, against one set of types,
 * instead of against a union that would have to be narrowed at every call site for a
 * difference that does not exist at runtime.
 *
 * drizzle-graphql and the query builder both read the *runtime* objects, so they see real
 * postgres tables and emit real postgres SQL.
 */
const active = isPostgres ? (pg as unknown as typeof sqlite) : sqlite;

export const { tasks, triggers, runs, mcpServers, settings, schema, relations } = active;

export type { McpServerRow, Run, Settings, Task, Trigger } from "./schema.sqlite.ts";
