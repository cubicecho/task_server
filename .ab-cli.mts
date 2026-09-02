// A minimal MCP client, so an agent can drive either surface from a shell and every call it
// makes is counted.
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [endpoint, command, name, json] = process.argv.slice(2);
const log = process.env.AB_LOG;
const client = new Client({ name: "ab", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));

function record(entry: Record<string, unknown>) {
  if (log) fs.appendFileSync(log, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
}

if (command === "list") {
  // Names and prose only. A real client is handed the input schemas here too, and on the
  // generated surface that is 423 kB — enough to swamp the arm before it starts, which would
  // measure context budget rather than comprehension. `schema <tool>` serves them one at a time.
  const { tools } = await client.listTools();
  record({ op: "list", tools: tools.length, bytes: JSON.stringify(tools).length });
  for (const tool of tools) console.log(`## ${tool.name}\n${tool.description ?? ""}\n`);
} else if (command === "schema") {
  // H2 runs schema-blind: names and prose are the whole of what the arm is given, which is the
  // regime where description quality is the only thing carrying the surface.
  if (process.env.AB_NO_SCHEMA) {
    record({ op: "schema", tool: name, refused: true });
    console.error("this surface does not publish input schemas — go by the descriptions");
    process.exit(1);
  }
  const { tools } = await client.listTools();
  const tool = tools.find((candidate) => candidate.name === name);
  record({ op: "schema", tool: name, found: Boolean(tool), bytes: JSON.stringify(tool ?? {}).length });
  if (!tool) {
    console.error(`no tool called ${name}`);
    process.exit(1);
  }
  console.log(JSON.stringify(tool.inputSchema, null, 2));
} else if (command === "call") {
  let args: Record<string, unknown> = {};
  try {
    args = json ? JSON.parse(json) : {};
  } catch (error) {
    record({ op: "call", tool: name, isError: true, reason: "unparseable json" });
    console.error(`arguments were not JSON: ${(error as Error).message}`);
    process.exit(1);
  }
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text?: string }[];
  };
  const text = result.content.map((part) => part.text ?? "").join("\n");
  // The generated surface answers 200 with a GraphQL error document inside, so `isError` alone
  // undercounts what an agent actually met as a failure.
  const envelope = text.startsWith("{") && text.includes('"errors"');
  record({
    op: "call",
    tool: name,
    args,
    isError: Boolean(result.isError) || envelope,
    chars: text.length,
  });
  console.log(text);
  if (result.isError) process.exit(1);
} else {
  console.error("usage: <endpoint> list | schema <tool> | call <tool> <json>");
  process.exit(2);
}
await client.close();
process.exit(0);
