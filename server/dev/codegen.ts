import fs from "node:fs";
import path from "node:path";
import { writeSchemaFile } from "../graphql/write-schema.ts";
import { ROOT } from "../paths.ts";

const TYPES_FILE = path.join(ROOT, "src/gql/graphql.ts");

/**
 * Regenerates `schema.graphql` and the typed documents when the schema has moved.
 *
 * The schema is generated from the Drizzle tables, so adding a column changes the API without
 * anyone editing the GraphQL — and the committed artefacts go stale silently. Booting the dev
 * server is the moment that is always true after such an edit, so it is where the check goes.
 *
 * Only for `npm run dev`. `@graphql-codegen/cli` is a devDependency and is not in the image;
 * production serves a `dist/` that was built with the types it was typechecked against, so
 * there is nothing to regenerate there and nothing to import.
 *
 * `tsx watch` restarts on every change under `server/`, so the SDL is compared before any of
 * the expensive work — an unchanged schema costs one `printSchema` and no codegen run.
 */
export async function runCodegen(): Promise<void> {
  const changed = writeSchemaFile();
  if (!changed && fs.existsSync(TYPES_FILE)) return;

  // Imported here rather than at the top so this module can be loaded in a tree that has no
  // devDependencies without the import itself throwing.
  const { generate } = await import("@graphql-codegen/cli");
  const { default: config } = await import("../../codegen.ts");

  await generate({ ...config, silent: true }, true);
  console.log("[task-server] codegen: schema.graphql and src/gql/graphql.ts are up to date");
}
