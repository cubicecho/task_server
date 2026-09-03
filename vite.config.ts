import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import codegen from "vite-plugin-graphql-codegen";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Regenerates `web/__generated__/graphql/graphql.ts` off vite's own watcher, so editing a
    // document in `web/graphql/` updates its typed node and hot-reloads without a second watch
    // process.
    codegen({
      // Off by default, and the half that matters here: `schema.graphql` is rewritten by the
      // dev server whenever the tables change, and that is what has to reach the types.
      matchOnSchemas: true,
      // `npm run build` runs codegen before typecheck — it has to, or tsc reads stale types —
      // so by the time vite starts there is nothing left to do.
      runOnBuild: false,
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./web", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    // In dev the SPA is served by vite on :3000 and the API runs separately on :8787, so
    // `POST /graphql` is forwarded rather than called cross-origin — the client can use the
    // same relative URL here as in production, where express serves both from one origin.
    // Nothing else is proxied: GraphQL is the only thing the web app talks to. The `/mcp`
    // endpoint is for agents, which reach the server on :8787 directly.
    proxy: {
      // Anchored, but the query string has to be allowed through: a subscription arrives as
      // `GET /graphql?query=…` over SSE, and `^/graphql$` would not match it.
      "^/graphql(\\?|$)": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
