import { expect, test } from "vitest";
import { parseMcpJson } from "../web/lib/mcp-config.ts";

const stdio = { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] };

test("reads a whole .mcp.json file, taking the slug from the entry's key", () => {
  const config = parseMcpJson(JSON.stringify({ mcpServers: { fs: stdio } }));
  expect(config).toMatchObject({ slug: "fs", transport: "stdio", command: "npx" });
  expect(JSON.parse(config.args)).toEqual(stdio.args);
});

test("reads a single named entry", () => {
  expect(parseMcpJson(JSON.stringify({ fs: stdio }))).toMatchObject({ slug: "fs", command: "npx" });
});

test("reads a bare body, which names no server", () => {
  const config = parseMcpJson(JSON.stringify(stdio));
  expect(config.slug).toBeUndefined();
  expect(config.command).toBe("npx");
});

test("a url means http, with or without a declared type", () => {
  expect(parseMcpJson(JSON.stringify({ url: "https://example.com/mcp" })).transport).toBe("http");
  expect(
    parseMcpJson(JSON.stringify({ type: "streamable-http", url: "https://example.com/mcp" }))
      .transport,
  ).toBe("http");
  expect(parseMcpJson(JSON.stringify({ type: "stdio", command: "npx" })).transport).toBe("stdio");
});

test("env and headers survive the round trip", () => {
  const config = parseMcpJson(JSON.stringify({ github: { command: "gh", env: { TOKEN: "x" } } }));
  expect(JSON.parse(config.env)).toEqual({ TOKEN: "x" });
});

test("says so when the paste is not JSON, or holds no server", () => {
  expect(() => parseMcpJson("not json")).toThrow(/valid JSON/);
  expect(() => parseMcpJson("{}")).toThrow(/No server/);
});
