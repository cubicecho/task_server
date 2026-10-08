import { expect, test } from "vitest";
import { fieldProblem, parseMcpJson } from "../web/lib/mcp-config.ts";

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
  expect(() => parseMcpJson("{}")).toThrow(/no server/);
});

test("refuses an SSE server by name rather than filling the form in as http", () => {
  const paste = JSON.stringify({ old: { type: "sse", url: "https://example.com/sse" } });
  expect(() => parseMcpJson(paste)).toThrow(/"old" is an SSE server/);
});

test("a disabled server unticks Enabled, and nothing else touches it", () => {
  expect(parseMcpJson(JSON.stringify({ fs: { ...stdio, disabled: true } })).enabled).toBe(false);
  expect(parseMcpJson(JSON.stringify({ fs: stdio }))).not.toHaveProperty("enabled");
});

test("a placeholder with no default stays as written, for the operator to fill in", () => {
  const paste = JSON.stringify({ gh: { command: "gh", env: { A: "${HOME}", B: "${NOPE:-x}" } } });
  expect(JSON.parse(parseMcpJson(paste).env)).toEqual({ A: "${HOME}", B: "x" });
});

test("a connection field is marked for the reason the save would be refused", () => {
  expect(fieldProblem("slug", " ")).toMatch(/needs a slug/);
  expect(fieldProblem("slug", "my server")).toMatch(/cannot namespace tool names/);
  expect(fieldProblem("command", "")).toBe("needs a command");
  expect(fieldProblem("url", "ftp://example.com")).toMatch(/not an http or https url/);
  expect(fieldProblem("args", '["-y"')).toBe("Args is not valid JSON.");
  expect(fieldProblem("args", '{"a": 1}')).toBe("args must be a list of strings");
  expect(fieldProblem("headers", '{"a": 1}')).toBe("headers must be an object of strings");
});

test("a field with nothing wrong with it says nothing", () => {
  for (const [field, text] of [
    ["slug", "fs"],
    ["command", "npx"],
    ["args", ""],
    ["env", '{"TOKEN": "x"}'],
    ["url", "https://example.com/mcp"],
    ["headers", ""],
  ] as const) {
    expect(fieldProblem(field, text)).toBeUndefined();
  }
});
