import path from "node:path";
import { defineConfig } from "drizzle-kit";
import { DATA_DIR, DATABASE_URL } from "./server/paths.ts";

/**
 * Follows `DATABASE_URL` like the server does, so `db:push` and `db:studio` act on the database
 * that is actually configured — the embedded PGlite one when nothing is set.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  ...(DATABASE_URL
    ? { dbCredentials: { url: DATABASE_URL } }
    : { driver: "pglite", dbCredentials: { url: path.join(DATA_DIR, "pg") } }),
});
