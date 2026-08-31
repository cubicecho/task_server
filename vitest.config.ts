import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // graphql ships both a CJS and an ESM build, and refuses to mix values across the two
      // ("Cannot use GraphQLObjectType from another module or realm"). Dependencies reach it
      // through `require`, so pinning the bare specifier to the CJS entry puts our own code
      // and theirs in the same realm for the duration of a test run.
      graphql: fileURLToPath(new URL("./node_modules/graphql/index.js", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
