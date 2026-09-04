import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * `schema.graphql` is written by `npm run schema`, which builds the runtime schema from the
 * Drizzle tables and prints it — so codegen always reads the same schema the server serves.
 * `npm run codegen` runs both in order.
 */
const scalars = { DateTime: "string", JSON: "unknown", UUID: "string", BigInt: "string" };

const config: CodegenConfig = {
  schema: "./schema.graphql",
  documents: "./web/graphql/**/*.graphql",
  ignoreNoDocuments: true,
  generates: {
    "./web/__generated__/graphql/graphql.ts": {
      plugins: ["typescript", "typescript-operations", "typed-document-node"],
      config: { scalars, useTypeImports: true, skipTypename: true },
    },
  },
};

export default config;
