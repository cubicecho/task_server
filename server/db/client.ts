import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/node-sqlite";
import pg from "pg";
import { DATABASE_URL } from "../paths.ts";
import { isPostgres } from "./dialect.ts";
import * as pgSchema from "./schema.pg.ts";
import * as sqliteSchema from "./schema.sqlite.ts";

/**
 * The database, opened from `DATABASE_URL`.
 *
 * SQLite is the default and the zero-install path: `node:sqlite` is built into Node, so a
 * fresh clone has a database the moment it boots, with nothing to run beside the server.
 * Postgres is for a deployment that has outgrown a file — more than one server process, a
 * managed backup, storage that is not the app's own disk.
 *
 * The choice is made here and nowhere else. `schema.ts` picks the matching table definitions,
 * `migrate.ts` the matching DDL, and everything above them is written against one `db`.
 */

/** The connection pool, on postgres. Null on SQLite. `ensure.pg.ts` is the only other reader. */
export const pool = isPostgres ? new pg.Pool({ connectionString: DATABASE_URL }) : null;

function openSqlite() {
  const file = DATABASE_URL.replace(/^file:/, "");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  return drizzleSqlite({ connection: { path: file }, relations: sqliteSchema.relations });
}

/**
 * The postgres client is handed out under the SQLite client's type, for the same reason the
 * tables are — see `schema.ts`. The two answer the query builder identically; they differ in
 * the raw handle beneath, and the only code that wants that reaches for `pool` instead.
 */
export const db = pool
  ? (drizzlePg({
      client: pool,
      relations: pgSchema.relations,
    }) as unknown as ReturnType<typeof openSqlite>)
  : openSqlite();

export type Db = typeof db;
