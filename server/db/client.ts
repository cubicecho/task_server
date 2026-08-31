import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import pg from "pg";
import { DATA_DIR, DATABASE_URL } from "../paths.ts";
import { relations } from "./schema.ts";

/**
 * The database. Postgres either way — the only question is whose.
 *
 * With no `DATABASE_URL`, the server runs PGlite: postgres itself, compiled to WebAssembly and
 * running inside this process against a directory under `data/`. A fresh clone boots with
 * nothing installed and nothing to start, and it is the same engine, the same SQL and the same
 * types as the deployed thing — which is the whole reason for it rather than a second dialect.
 *
 * With a `postgres://` URL it is a real postgres server over node-postgres: more than one
 * server process, a managed backup, storage that is not the app's own disk.
 *
 * The choice is made here and nowhere else. Everything above this file is written against one
 * `db` and one set of tables.
 */

const server = /^postgres(ql)?:\/\//.test(DATABASE_URL);

const pool = server ? new pg.Pool({ connectionString: DATABASE_URL }) : null;

// Anything that is not a `postgres://` URL is where PGlite keeps its data: a directory, or one
// of its own schemes — `memory://` for a database that lives and dies with the process, which
// is what the tests run on.
const store = DATABASE_URL || path.join(DATA_DIR, "pg");

// PGlite creates its own directory but not the parent, and `data/` is gitignored — so a fresh
// clone has none to create it in. A scheme is not a path and is left alone.
if (!server && !store.includes("://")) fs.mkdirSync(store, { recursive: true });

const embedded = server ? null : new PGlite(store);

/**
 * PGlite's database is handed out under node-postgres' type. The two are the same postgres to
 * the query builder — same dialect, same SQL, same row shapes — and differ only in `$client`,
 * the raw handle, which nothing above this file reaches for.
 */
export const db = pool
  ? drizzleNode({ client: pool, relations })
  : (drizzlePglite({
      client: embedded as PGlite,
      relations,
    }) as unknown as ReturnType<typeof drizzleNode<typeof relations>>);

export type Db = typeof db;

/**
 * Runs a script of several statements as one implicit transaction — `ensure.ts` is the only
 * caller, and it wants a half-made schema to be impossible.
 *
 * Both drivers send it over the simple query protocol, which is what makes the batch atomic;
 * the query builder's own `execute` uses the extended protocol, which takes one statement.
 */
export const runScript = (sql: string): Promise<unknown> =>
  pool ? pool.query(sql) : (embedded as PGlite).exec(sql);
