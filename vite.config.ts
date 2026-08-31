import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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
      "^/graphql$": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
