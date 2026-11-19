import type { GraphQLSchema } from "graphql";
import { graphql } from "graphql";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import type { McpServerRow } from "../server/db/schema.ts";
import { dataDir, echoRow } from "./helpers.ts";

// The schema is built from the live Drizzle tables at import time, so the database has to be
// pointed somewhere disposable before anything under server/ is loaded.
dataDir("mcp-prompts");

/**
 * What a server offers a picker, read off a real connection through the schema both doors
 * serve.
 *
 * The protocol work is the pool's now — the listing, the expansion and the completion — so what
 * is pinned here is that this server asks it the right questions and hands the picker what it
 * reads. No mocks for the reason the pool's own tests use none: the SDK checks a server's
 * declared capabilities before it sends any of these requests, and a stub of the client would be
 * a stub of the very check being relied on.
 */
const config = (env: Record<string, string> = { MCP_ECHO_PROMPTS: "1" }): McpServerRow =>
  echoRow({ env });

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

const ask = async (source: string, variableValues?: Record<string, unknown>) => {
  const { data, errors } = await graphql({ schema, source, variableValues });
  return { data: data as Record<string, unknown> | null | undefined, errors };
};

const listed = async () => {
  const { data, errors } = await ask(
    `{ mcpPrompts { server serverLabel name title arguments { name description required } } }`,
  );
  expect(errors).toBeUndefined();
  return data?.mcpPrompts as {
    server: string;
    serverLabel: string;
    name: string;
    title: string;
    arguments: { name: string; description: string; required: boolean }[];
  }[];
};

const expand = (name: string, args?: Record<string, string>, server = "echo-1") =>
  ask(
    `query ($server: String!, $name: String!, $args: JSON) {
    mcpPrompt(server: $server, name: $name, args: $args)
  }`,
    { server, name, args },
  );

const complete = (argument: string, value: string, context?: Record<string, string>) =>
  ask(
    `query ($argument: String!, $value: String!, $context: JSON) {
    mcpPromptCompletion(server: "echo-1", name: "greet", argument: $argument, value: $value, context: $context)
  }`,
    { argument, value, context },
  );

test("lists what a connected server offers, carrying the server on every row", async () => {
  await mcp.sync([config()]);

  const prompts = await listed();
  expect(prompts.map((prompt) => prompt.name)).toEqual(["greet", "worked-example", "attached"]);
  // Two servers may name a prompt the same, so a row is only addressable with both halves.
  expect(prompts[0]).toMatchObject({
    server: "echo-1",
    serverLabel: "Echo",
    title: "Greet somebody",
  });
  // Omitting `required` is how the protocol says "optional"; a picker reads it as a boolean.
  expect(prompts[0].arguments).toEqual([
    { name: "who", description: "The name to greet", required: true },
    { name: "mood", description: "How warmly", required: false },
  ]);
});

test("a server that pages its prompts is listed to the last page", async () => {
  await mcp.sync([config({ MCP_ECHO_PROMPTS: "1", MCP_ECHO_PROMPT_PAGE: "1" })]);

  // One to a page: reading only the first showed `greet` as the whole of what this server had.
  expect((await listed()).map((prompt) => prompt.name)).toEqual([
    "greet",
    "worked-example",
    "attached",
  ]);
});

test("a server that declares no prompts is never asked, and offers none", async () => {
  await mcp.sync([config({})]);

  expect(mcp.state()).toMatchObject([{ status: "ready" }]);
  expect(await listed()).toEqual([]);
});

test("a disabled server is not in the picker", async () => {
  await mcp.sync([{ ...config(), enabled: false }]);

  expect(await listed()).toEqual([]);
});

test("expands a template with the arguments given, verbatim when it is one message", async () => {
  await mcp.sync([config()]);

  const { data, errors } = await expand("greet", { who: "Ada" });
  expect(errors).toBeUndefined();
  expect(data?.mcpPrompt).toBe("Say hello to Ada.");
});

test("labels the roles when a template answers with more than one message", async () => {
  await mcp.sync([config()]);

  // Lossy and deliberately so: a prompt is one string, and a worked example quoted inside it is
  // still readable as one where a dropped role would not be.
  expect((await expand("worked-example")).data?.mcpPrompt).toBe(
    "assistant: Here is how I would answer.\n\nuser: Now do it for mine.",
  );
});

test("names content that has no text rather than dropping it", async () => {
  await mcp.sync([config()]);

  const expansion = String((await expand("attached")).data?.mcpPrompt);
  // An embedded resource carries its text and unwraps to it; an image cannot, and leaving a gap
  // where it was would read as a template that simply said less.
  expect(expansion).toContain("user: A");
  expect(expansion).toContain("[image image/png");
});

test("a server that offers no prompts is refused as one, before anything is sent", async () => {
  await mcp.sync([config({})]);

  const { errors } = await expand("greet", { who: "Ada" });
  expect(errors?.map((error) => error.extensions?.code)).toEqual(["UNSUPPORTED"]);
  expect(errors?.[0].message).toBe("The MCP server echo does not offer prompts.");
});

test("a server that is not configured is refused as one", async () => {
  await mcp.sync([config()]);

  const { errors } = await expand("greet", {}, "nowhere");
  expect(errors?.map((error) => error.extensions?.code)).toEqual(["UNSUPPORTED"]);
  expect(errors?.[0].message).toBe("The MCP server nowhere is not configured here any more.");
});

test("completes an argument from what has been typed into it", async () => {
  await mcp.sync([config({ MCP_ECHO_PROMPTS: "1", MCP_ECHO_COMPLETIONS: "1" })]);

  const { data, errors } = await complete("who", "a");
  expect(errors).toBeUndefined();
  expect(data?.mcpPromptCompletion).toEqual(["Ada", "Alan"]);
});

test("a later argument is completed knowing the earlier ones", async () => {
  await mcp.sync([config({ MCP_ECHO_PROMPTS: "1", MCP_ECHO_COMPLETIONS: "1" })]);

  // The context is what lets a server narrow — a folder first, then the documents in it.
  expect((await complete("mood", "", { who: "Ada" })).data?.mcpPromptCompletion).toEqual([
    "fond",
    "wry",
  ]);
  expect((await complete("mood", "")).data?.mcpPromptCompletion).toEqual(["polite"]);
});

test("a server that cannot complete suggests nothing rather than failing", async () => {
  await mcp.sync([config()]);

  // The picker asks on every pause in typing, so "no suggestions" cannot be an error.
  const { data, errors } = await complete("who", "a");
  expect(errors).toBeUndefined();
  expect(data?.mcpPromptCompletion).toEqual([]);
});
