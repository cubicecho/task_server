import type { GraphQLSchema } from "graphql";
import { graphql } from "graphql";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import type { McpServerRow } from "../server/db/schema.ts";
import { dataDir, echoRow } from "./helpers.ts";

// The schema is built from the live Drizzle tables at import time, so the database has to be
// pointed somewhere disposable before anything under server/ is loaded.
dataDir("mcp-resources");

/**
 * A run's artifact read back for a preview, through the schema both doors serve and against a
 * real connection — the SDK checks a server's declared capabilities before it sends
 * `resources/read`, and a stub of the client would be a stub of the very check relied on.
 */
const config = (over: Partial<McpServerRow> = {}) =>
  echoRow({ env: { MCP_ECHO_RESOURCES: "1" }, ...over });

let schema: GraphQLSchema;
let mcp: typeof import("../server/runner/mcp.ts")["mcp"];
let cron: typeof import("../server/scheduler/cron.ts");

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  schema = (await import("../server/graphql/schema.ts")).schema;
  ({ mcp } = await import("../server/runner/mcp.ts"));
  cron = await import("../server/scheduler/cron.ts");
});

afterEach(async () => {
  await mcp.shutdown();
});

afterAll(async () => {
  await cron.stop();
});

const read = (uri: string, caller?: "operator" | "agent") =>
  graphql({
    schema,
    source: `query ($uri: String!) {
      mcpResource(serverId: "echo-1", uri: $uri) { uri mimeType text truncated }
    }`,
    variableValues: { uri },
    contextValue: caller ? { caller } : undefined,
  });

test("reads a resource's text back from the server that serves it", async () => {
  await mcp.sync([config()]);

  const { data, errors } = await read("doc://notes/plan.md");
  expect(errors).toBeUndefined();
  expect(data?.mcpResource).toEqual({
    uri: "doc://notes/plan.md",
    mimeType: "text/markdown",
    text: "# doc://notes/plan.md\n\nRead back from the echo server.",
    truncated: false,
  });
});

test("names binary contents rather than sending them", async () => {
  await mcp.sync([config()]);

  const { data, errors } = await read("bin://picture");
  expect(errors).toBeUndefined();
  const resource = data?.mcpResource as { mimeType: string; text: string; truncated: boolean };
  expect(resource).toMatchObject({ mimeType: "image/png", truncated: false });
  // The bytes are the server's and stay there; the preview is told what they were.
  expect(resource.text).toMatch(/^\[.*image\/png.*\]$/);
  expect(resource.text).not.toContain("aGk=");
});

test("a server that declares no resources is refused as one that cannot preview", async () => {
  await mcp.sync([config({ env: {} })]);

  const { errors } = await read("doc://notes/plan.md");
  expect(errors?.map((error) => error.extensions?.code)).toEqual(["UNSUPPORTED"]);
  expect(errors?.[0].message).toBe(
    "The MCP server echo does not serve resources, so nothing it made can be previewed.",
  );
});

test("an agent may not read a resource, whatever the server would serve", async () => {
  await mcp.sync([config()]);

  const { data, errors } = await read("doc://notes/plan.md", "agent");
  expect(errors?.map((error) => error.extensions?.code)).toEqual(["FORBIDDEN"]);
  expect(data?.mcpResource).toBeUndefined();
});
