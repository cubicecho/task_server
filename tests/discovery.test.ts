import http, { type Server } from "node:http";
import { type AddressInfo, Socket } from "node:net";
import { cardConnection, parseAiCatalog, parseServerCard } from "@cubicecho/mcp-discovery";
import express from "express";
import { afterAll, beforeAll, expect, test } from "vitest";
import { dataDir } from "./helpers.ts";

// The MCP endpoint serves the real schema, which is built against the live tables.
dataDir("discovery");

let server: Server;
let port: number;
let discoveryEndpoints: typeof import("../server/discovery/endpoints.ts").discoveryEndpoints;

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  const endpoints = await import("../server/discovery/endpoints.ts");
  const { mountMcp } = await import("../server/mcp-endpoint.ts");
  discoveryEndpoints = endpoints.discoveryEndpoints;

  // The order `index.ts` mounts them in, with a catch-all standing in for the client app's
  // fallback: the discovery documents have to be answered before it.
  const app = express();
  endpoints.mountDiscovery(app);
  mountMcp(app);
  app.get("/{*path}", (_req, res) => {
    res.type("html").send("<!doctype html>");
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** A GET with the `Host` header a client on the LAN would send, which `fetch` will not set. */
function get(path: string, host = `127.0.0.1:${port}`) {
  return new Promise<{ status: number; type: string; body: unknown }>((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path, headers: { host } }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          type: response.headers["content-type"] ?? "",
          body: JSON.parse(text),
        }),
      );
    });
    request.on("error", reject);
  });
}

test("serves an AI Catalog that lists the card of /mcp", async () => {
  const response = await get("/.well-known/ai-catalog.json");
  expect(response.status).toBe(200);
  expect(response.type).toContain("application/ai-catalog+json");
  const catalog = parseAiCatalog(response.body, "test");
  expect(catalog.entries.map((entry) => entry.url)).toEqual([
    `http://127.0.0.1:${port}/mcp/server-card`,
  ]);
});

test("serves a card that names /mcp at the address the client used, and asks for no token", async () => {
  const response = await get("/mcp/server-card", "nas.local:8787");
  expect(response.status).toBe(200);
  const card = parseServerCard(response.body, "test");
  expect(card.name).toMatch(/^io\.github\.cubicecho\.task-server\.[a-z0-9-]+\/tasks$/);
  expect(card.repository?.url).toBe("https://github.com/cubicecho/task_server");
  // There is no authentication on this server, so a client has nothing to supply.
  expect(cardConnection(card)).toEqual({ url: "http://nas.local:8787/mcp", requiredHeaders: [] });
});

test("names the card after the host, so two task servers on one network stay apart", async () => {
  const [endpoint] = discoveryEndpoints("NAS.lan");
  expect(endpoint.path).toBe("/mcp");
  expect(endpoint.identifier).toBe("urn:air:nas.task-server:mcp:tasks");
  const card = await endpoint.card({
    endpointUrl: "http://nas.lan:8787/mcp",
    request: new http.IncomingMessage(new Socket()),
  });
  expect(card.name).toBe("io.github.cubicecho.task-server.nas/tasks");
  expect(card.title).toBe("Task Server on NAS.lan");
});
