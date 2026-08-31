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
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Every suite gets its own PGlite, in memory: real postgres, no server to start, and
    // nothing left behind when the process ends. See `server/db/client.ts`.
    env: { DATABASE_URL: "memory://" },
    // A postgres per worker is real work, and the suites that spawn MCP servers over stdio are
    // waiting on child processes while it happens. The default 5s is tight enough that a
    // loaded machine trips it; nothing here is meant to take anything like this long.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
