import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// One line per process started. The pool is supposed to keep one child per configured server,
// and nothing it exposes can tell one child from two — so the children say so themselves.
if (process.env.MCP_ECHO_SPAWN_LOG)
  appendFileSync(process.env.MCP_ECHO_SPAWN_LOG, `${process.pid}\n`);

/** A stdio MCP server with three trivial tools, for the runner tests to connect to. */
const tools = [
  { name: "ping", description: "replies pong", inputSchema: { type: "object", properties: {} } },
  {
    name: "echo",
    description: "echoes the text back",
    // A union type, so the tests see a real schema go through the sanitizer.
    inputSchema: { type: "object", properties: { text: { type: ["string", "null"] } } },
  },
  {
    name: "add",
    description: "adds two numbers",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
];

/**
 * Prompt templates, behind `MCP_ECHO_PROMPTS` so that a test can have a server that offers none.
 *
 * The capability is what a client reads before it asks — the SDK refuses `prompts/list` against
 * a server that never declared it — so the two have to move together, which is why the flag
 * gates the capability rather than only the handlers.
 */
const prompts = [
  {
    name: "greet",
    title: "Greet somebody",
    description: "Says hello to a name you give it",
    arguments: [
      { name: "who", description: "The name to greet", required: true },
      { name: "mood", description: "How warmly" },
    ],
  },
  { name: "worked-example", description: "Two messages, to be flattened into one" },
  { name: "attached", description: "Content that is not text at all" },
];

/** What each template expands to. A list of messages, which is what the protocol answers with. */
const expand = {
  greet: (args) => [
    { role: "user", content: { type: "text", text: `Say hello to ${args.who ?? "nobody"}.` } },
  ],
  "worked-example": () => [
    { role: "assistant", content: { type: "text", text: "Here is how I would answer." } },
    { role: "user", content: { type: "text", text: "Now do it for mine." } },
  ],
  attached: () => [
    { role: "user", content: { type: "resource", resource: { uri: "doc://a", text: "A" } } },
    // Real base64: the SDK validates the field, and a placeholder is refused before it ships.
    { role: "user", content: { type: "image", mimeType: "image/png", data: "aGk=" } },
  ],
};

const server = new Server(
  { name: "echo", version: "0.0.1" },
  { capabilities: { tools: {}, ...(process.env.MCP_ECHO_PROMPTS ? { prompts: {} } : {}) } },
);

// The `clientInfo` of the handshake, when a test asks for it. It is the whole of what a dialled
// server learns about who is calling it, and nothing on the pool's side of the connection can
// read it back — so, like the spawn log above, the child is the only witness.
if (process.env.MCP_ECHO_CLIENT_LOG)
  server.oninitialized = () => {
    const client = server.getClientVersion();
    appendFileSync(process.env.MCP_ECHO_CLIENT_LOG, `${client?.name}/${client?.version}\n`);
  };
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, (request) => ({
  content: [
    {
      type: "text",
      text: `${request.params.name}(${JSON.stringify(request.params.arguments ?? {})})`,
    },
  ],
}));

if (process.env.MCP_ECHO_PROMPTS) {
  server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts }));
  server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const messages = expand[request.params.name];
    if (!messages) throw new Error(`no prompt named ${request.params.name}`);
    return { messages: messages(request.params.arguments ?? {}) };
  });
}

await server.connect(new StdioServerTransport());
