import fs from "node:fs";
import path from "node:path";
import { printSchema } from "graphql";
import { ROOT } from "../paths.ts";
import { schema } from "./schema.ts";

export const SCHEMA_FILE = path.join(ROOT, "schema.graphql");

/**
 * Writes the runtime schema to `schema.graphql`, the file graphql-codegen reads.
 *
 * The schema is built from the Drizzle tables when the process starts, so codegen has no
 * static file of its own; this makes one. It reads the table *definitions* and never the
 * database, so nothing is queried and no schema is created — this works on an empty checkout
 * and against a `postgres://` URL with nothing listening on it.
 *
 * Returns whether the file changed, so a caller that runs on every restart can skip the work
 * that follows when it did not.
 */
export function writeSchemaFile(): boolean {
  const sdl = printSchema(schema);
  const current = fs.existsSync(SCHEMA_FILE) ? fs.readFileSync(SCHEMA_FILE, "utf8") : null;
  if (current === sdl) return false;
  fs.writeFileSync(SCHEMA_FILE, sdl, "utf8");
  return true;
}
