import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, expect, test } from "vitest";
import { mountClientApp } from "../server/client-app.ts";

const HTML = "<!doctype html><title>task-server</title>";

let home: string;
let base: string;
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  // A dot-directory above `dist/`, as a worktree under `.claude/worktrees/` has.
  home = fs.mkdtempSync(path.join(os.tmpdir(), "client-app-"));
  const dist = path.join(home, ".hidden", "dist");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), HTML);
  fs.writeFileSync(path.join(dist, "assets", "app.js"), "export {};");

  const app = express();
  mountClientApp(app, dist);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("a deep link is answered with the app under a dot-directory", async () => {
  for (const route of ["/agents", "/settings", "/tasks/abc"]) {
    const response = await fetch(`${base}${route}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(HTML);
  }
});

test("a built file is served as itself, not as the app", async () => {
  const response = await fetch(`${base}/assets/app.js`);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("export {};");
});
