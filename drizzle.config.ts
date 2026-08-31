import { defineConfig } from "drizzle-kit";
import { DATABASE_URL } from "./server/paths.ts";

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: DATABASE_URL },
});
