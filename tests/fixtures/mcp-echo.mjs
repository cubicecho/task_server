import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

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

const server = new Server({ name: "echo", version: "0.0.1" }, { capabilities: { tools: {} } });

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

await server.connect(new StdioServerTransport());
