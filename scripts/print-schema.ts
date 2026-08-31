import path from "node:path";
import { SCHEMA_FILE, writeSchemaFile } from "../server/graphql/write-schema.ts";
import { ROOT } from "../server/paths.ts";

/** `npm run schema`. The writing, and why it is safe to do without a database, is in there. */
const changed = writeSchemaFile();
console.log(`${changed ? "wrote" : "unchanged"} ${path.relative(ROOT, SCHEMA_FILE)}`);
process.exit(0);
