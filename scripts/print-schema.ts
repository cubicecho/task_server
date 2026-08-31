import fs from "node:fs";
import path from "node:path";
import { printSchema } from "graphql";
import { ROOT } from "../server/paths.ts";

/**
 * Writes the SDL to `schema.graphql` for graphql-codegen.
 *
 * The schema is generated from the Drizzle tables at runtime, so codegen has no static file to
 * read; this makes one. Run it whenever the tables change — `npm run codegen` does it first.
 *
 * It reads the table *definitions*, never the database, so no schema is created here and none
 * needs to exist: codegen runs against an empty checkout, and against a `postgres://` URL with
 * nothing listening on it.
 *
 * Run it under `DATABASE_URL=postgres://…` and the SDL gains one field — `contains` on
 * `JSONFilter`, which is `@>` and has no SQLite equivalent. The committed `schema.graphql` is
 * the SQLite one, the app's own documents do not use that filter, and the generated client is
 * the same either way; so codegen on postgres produces a one-field diff worth discarding
 * rather than committing.
 */
const { schema } = await import("../server/graphql/schema.ts");
const file = path.join(ROOT, "schema.graphql");
fs.writeFileSync(file, printSchema(schema), "utf8");
console.log(`wrote ${path.relative(ROOT, file)}`);
process.exit(0);
