import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = createRequire(import.meta.url).resolve;

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // graphql ships both a CJS and an ESM build, and refuses to mix values across the two
      // ("Cannot use GraphQLObjectType from another module or realm"). Dependencies reach it
      // through `require`, so pinning the bare specifier to the CJS entry puts our own code
      // and theirs in the same realm for the duration of a test run. Resolved rather than
      // spelled out: a git worktree has no `node_modules` of its own and finds the package by
      // walking up, and a hard-coded path would leave the tests unrunnable there.
      graphql: resolve("graphql"),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
