import express, { type Express } from "express";

/**
 * Serves the built web app from `dist`: its files as they are, and `index.html` for every other
 * path but the two API doors, so a deep link or a refresh lands on the client's router.
 *
 * `index.html` is sent by name under `root` rather than as an absolute path. `send` refuses a
 * dot-segment anywhere in the path it is handed, so a checkout under `.claude/worktrees/` or
 * `~/.local/` answered every deep link with a 500; with a root only the part under `dist/` is
 * checked.
 */
export function mountClientApp(app: Express, dist: string) {
  app.use(express.static(dist));
  app.get(/^(?!\/(graphql|mcp)$).*/, (_req, res) => res.sendFile("index.html", { root: dist }));
}
