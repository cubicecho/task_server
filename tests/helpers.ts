import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { ExecutionResult } from "graphql";
import type { McpServerRow, Settings } from "../server/db/schema.ts";
import type { Fired } from "../server/runner/run.ts";
import { type ChatBody, notChat } from "./fixtures/sse.ts";

/**
 * What the suites that need a model, or a database pointed at one, would otherwise each write
 * out. Nothing under `server/` is imported at the top: a suite sets `TASK_SERVER_DATA_DIR`
 * before it loads any of that, and a static import here would load it first.
 */

export interface FakeModel {
  /** What `settings.baseUrl` is set to. */
  baseUrl: string;
  close(): Promise<void>;
}

type Route = (request: http.IncomingMessage, response: http.ServerResponse) => boolean;

async function listen(server: http.Server): Promise<FakeModel> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => {
      // A stopped run's request is aborted, but the question it asked of `/models` first is
      // not the run's to cancel, and a server that never answers would wait on it.
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * A model server on a local port that hands each chat request to `answer`.
 *
 * `elsewhere` gets every request first and says whether it answered it; by default that is
 * `notChat`, a 404 for everything that is not a chat request.
 */
export const fakeModel = (
  answer: (body: ChatBody, response: http.ServerResponse) => void,
  elsewhere: Route = notChat,
): Promise<FakeModel> =>
  listen(
    http.createServer((request, response) => {
      if (elsewhere(request, response)) return;
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => answer(JSON.parse(body), response));
    }),
  );

/** A model server that accepts the request and never answers, so a run stays in flight. */
export const hangingModel = (): Promise<FakeModel> => listen(http.createServer(() => {}));

/** Points the settings row at a fake model, which is what every run then talks to. */
export async function useModel(model: FakeModel) {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../server/db/client.ts");
  const { settings } = await import("../server/db/schema.ts");
  await db
    .update(settings)
    .set({ baseUrl: model.baseUrl, model: "fake" })
    .where(eq(settings.id, "default"));
}

/**
 * A settings row for a run handed its config directly, with nothing left to chance: no retries
 * and no watchdog, so a test that wants either says so.
 */
export const settingsRow = (over: Partial<Settings> = {}): Settings => ({
  id: "default",
  baseUrl: "",
  apiKey: "",
  model: "fake",
  systemPrompt: "",
  maxTokens: 256,
  temperature: 0,
  maxToolIterations: 3,
  toolDiscovery: "eager",
  toolSelectModel: "",
  runRetentionDays: 30,
  requestTimeoutSeconds: 0,
  maxRetries: 0,
  maxConcurrentRuns: 4,
  ...over,
});

/** The stdio MCP server the suites dial: real protocol, real child process, tools that echo. */
export const ECHO_FIXTURE = fileURLToPath(new URL("./fixtures/mcp-echo.mjs", import.meta.url));

/**
 * The echo fixture as the table hands a server over — both transports' columns and all, since
 * that is what `load()` returns and what `mcp.sync` is given.
 */
export const echoRow = (over: Partial<McpServerRow> = {}): McpServerRow => ({
  id: "echo-1",
  slug: "echo",
  label: "Echo",
  enabled: true,
  transport: "stdio",
  command: process.execPath,
  args: [ECHO_FIXTURE],
  env: null,
  url: "",
  headers: null,
  hiddenTools: null,
  hooks: null,
  ...over,
});

/**
 * Waits for something another part of the process is about to make true — a run reaching the
 * map, a debounced drain — and fails by name when it never does, rather than at the suite's
 * timeout with nothing to say which wait it was.
 */
export async function until(ready: () => boolean | Promise<boolean>, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out after ${ms} ms waiting for: ${ready}`);
}

/** The firing as one that started a run, or a failure saying why it did not. */
export function started(fired: Fired): Extract<Fired, { started: true }> {
  if (!fired.started) throw new Error(`expected the firing to start a run, but: ${fired.reason}`);
  return fired;
}

/** The firing as one that was turned away, skipped or queued. */
export function refused(fired: Fired): Extract<Fired, { started: false }> {
  if (fired.started) throw new Error("expected the firing to be refused, but it started a run");
  return fired;
}

/**
 * The code a refusal carried, which is what a client branches on. The sentence beside it is
 * for a person and is free to be reworded.
 */
export const refusalCode = (result: ExecutionResult) => result.errors?.[0]?.extensions.code;
