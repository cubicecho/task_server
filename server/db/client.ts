import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DATABASE_URL } from "../paths.ts";
import { relations } from "./schema.ts";

/**
 * SQLite via Node's built-in `node:sqlite` — no native module to build.
 *
 * The postgres swap is deliberately confined to this file plus `schema.ts`: everything above
 * imports `db` and nothing else. Making it real means a `pg-core` copy of the table
 * definitions and `drizzle-orm/node-postgres` here, chosen off the `postgres://` URL. Doing
 * that now would mean maintaining two schemas before either has a user, so the seam is a
 * thrown error rather than a half-written dialect.
 */
function open() {
  if (!DATABASE_URL.startsWith("file:") && !DATABASE_URL.startsWith("/")) {
    throw new Error(
      `Only SQLite is wired up; DATABASE_URL was ${DATABASE_URL}. See server/db/client.ts.`,
    );
  }
  const file = DATABASE_URL.replace(/^file:/, "");
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  return drizzle({ connection: { path: file }, relations });
}

export const db = open();
export type Db = typeof db;
