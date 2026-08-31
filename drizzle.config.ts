import { defineConfig } from "drizzle-kit";
import { DIALECT } from "./server/db/dialect.ts";
import { DATABASE_URL } from "./server/paths.ts";

/**
 * Follows `DATABASE_URL` like the server does, so `db:push` and `db:studio` act on the
 * database that is actually configured. The schema file and the output directory are per
 * dialect: a postgres diff and a SQLite diff describe different tables and must not share a
 * folder.
 */
export default defineConfig({
  dialect: DIALECT === "postgres" ? "postgresql" : "sqlite",
  schema: DIALECT === "postgres" ? "./server/db/schema.pg.ts" : "./server/db/schema.sqlite.ts",
  out: `./drizzle/${DIALECT}`,
  dbCredentials: { url: DATABASE_URL },
});
