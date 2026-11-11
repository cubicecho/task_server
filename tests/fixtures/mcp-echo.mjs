import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// One line per process started. The pool is supposed to keep one child per configured server,
// and nothing it exposes can tell one child from two — so the children say so themselves.
if (process.env.MCP_ECHO_SPAWN_LOG) {
  appendFileSync(process.env.MCP_ECHO_SPAWN_LOG, `${process.pid}\n`);
}

/**
 * A stdio MCP server with three trivial tools, for the runner tests to connect to — more behind
 * the `MCP_ECHO_*` flags below.
 */
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
  // A tool that waits for longer than any test does, behind `MCP_ECHO_SLOW` so that the suites
  // which count this server's tools still see three. It answers only if nobody cancels it.
  ...(process.env.MCP_ECHO_SLOW
    ? [{ name: "slow", description: "takes a minute", inputSchema: { type: "object" } }]
    : []),
  // A tool that says what it made the way MCP says it, behind `MCP_ECHO_LINKS` for the same
  // reason: a `resource_link` to `uri`, with the fields a run's artifact row keeps.
  ...(process.env.MCP_ECHO_LINKS
    ? [
        {
          name: "write",
          description: "writes a document and links to it",
          inputSchema: {
            type: "object",
            properties: { uri: { type: "string" }, title: { type: "string" } },
            required: ["uri"],
          },
        },
      ]
    : []),
  // Two tools that take a moment, behind `MCP_ECHO_TIMED`: one that says it only reads and one
  // that says it does not. Each notes when it started and finished in `MCP_ECHO_TIMING_LOG`, so
  // a test can see which calls overlapped — which only the child can witness.
  ...(process.env.MCP_ECHO_TIMED
    ? [
        {
          name: "look",
          description: "reads something, slowly",
          inputSchema: { type: "object", properties: { tag: { type: "string" } } },
          annotations: { readOnlyHint: true },
        },
        {
          name: "poke",
          description: "changes something, slowly",
          inputSchema: { type: "object", properties: { tag: { type: "string" } } },
          annotations: { readOnlyHint: false, destructiveHint: false },
        },
      ]
    : []),
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

/**
 * What `completion/complete` suggests for `greet`'s arguments, behind `MCP_ECHO_COMPLETIONS` and
 * for the prompts' reason. `who` is a prefix match over a few names; `mood` is narrowed by the
 * `who` already filled in, which is the whole point of the request carrying a context.
 */
const NAMES = ["Ada", "Alan", "Grace"];
const MOODS = { Ada: ["fond", "wry"] };
const completions = (argument, context) =>
  argument.name === "who"
    ? NAMES.filter((name) => name.toLowerCase().startsWith(argument.value.toLowerCase()))
    : argument.name === "mood"
      ? (MOODS[context?.arguments?.who] ?? ["polite"])
      : [];

/**
 * What `resources/read` answers, behind `MCP_ECHO_RESOURCES` and for the prompts' reason: the
 * capability is what a client checks before it asks, so it moves with the handler. A uri under
 * `bin://` is answered as a blob, and any other as markdown that names the uri it was asked for.
 */
const resource = (uri) =>
  uri.startsWith("bin://")
    ? { uri, mimeType: "image/png", blob: "aGk=" }
    : { uri, mimeType: "text/markdown", text: `# ${uri}\n\nRead back from the echo server.` };

const server = new Server(
  { name: "echo", version: "0.0.1" },
  {
    // What the handshake tells a client about using this server, when a test gives it some.
    ...(process.env.MCP_ECHO_INSTRUCTIONS
      ? { instructions: process.env.MCP_ECHO_INSTRUCTIONS }
      : {}),
    capabilities: {
      tools: {},
      ...(process.env.MCP_ECHO_PROMPTS ? { prompts: {} } : {}),
      ...(process.env.MCP_ECHO_COMPLETIONS ? { completions: {} } : {}),
      ...(process.env.MCP_ECHO_RESOURCES ? { resources: {} } : {}),
    },
  },
);

// The `clientInfo` of the handshake, when a test asks for it. It is the whole of what a dialled
// server learns about who is calling it, and nothing on the pool's side of the connection can
// read it back — so, like the spawn log above, the child is the only witness.
if (process.env.MCP_ECHO_CLIENT_LOG) {
  server.oninitialized = () => {
    const client = server.getClientVersion();
    appendFileSync(process.env.MCP_ECHO_CLIENT_LOG, `${client?.name}/${client?.version}\n`);
  };
}
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
// Every call as one JSON line, when a test asks. A hook's call reaches the server and nothing
// else — it is not a run event and not a tool call on the run — so the child is its witness too.
server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
  if (process.env.MCP_ECHO_CALL_LOG) {
    appendFileSync(
      process.env.MCP_ECHO_CALL_LOG,
      `${JSON.stringify({ name: request.params.name, arguments: request.params.arguments ?? {} })}\n`,
    );
  }
  if (request.params.name === "slow") {
    return waitForCancel(extra.signal).then(() => reply(request));
  }
  if (request.params.name === "write") {
    return written(request);
  }
  if (request.params.name === "look" || request.params.name === "poke") {
    return timed(request);
  }
  return reply(request);
});

/** `look` and `poke`: a tenth of a second's work, bracketed in the timing log. */
const timed = async (request) => {
  const note = (at) => {
    if (process.env.MCP_ECHO_TIMING_LOG) {
      const { tag } = request.params.arguments ?? {};
      const line = JSON.stringify({ at, name: request.params.name, tag });
      appendFileSync(process.env.MCP_ECHO_TIMING_LOG, `${line}\n`);
    }
  };
  note("start");
  await new Promise((resolve) => setTimeout(resolve, 100));
  note("end");
  return reply(request);
};

/**
 * Sleeps a minute, or until the client sends `notifications/cancelled` for the request — which
 * the SDK turns into `signal` aborting. A cancellation reaches the server and nothing else, so it
 * goes in `MCP_ECHO_CANCEL_LOG` for a test to read, as the calls do above.
 */
const waitForCancel = (signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, 60_000);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      if (process.env.MCP_ECHO_CANCEL_LOG) {
        appendFileSync(process.env.MCP_ECHO_CANCEL_LOG, `${String(signal.reason)}\n`);
      }
      resolve();
    });
  });

/**
 * `write`'s answer: what the model reads, and a link to what it made beside it. One whose
 * `audience` leaves out the user is the model's alone, and the host is never handed it.
 */
const written = (request) => {
  const { uri, title } = request.params.arguments ?? {};
  return {
    content: [
      { type: "text", text: `wrote ${uri}` },
      {
        type: "resource_link",
        uri,
        name: String(uri).split("/").pop(),
        ...(title ? { title } : {}),
        mimeType: "text/markdown",
        description: "a document the echo server wrote",
        annotations: { audience: ["user", "assistant"], lastModified: "2026-11-01T12:00:00Z" },
        _meta: { "com.cubicecho/webUrl": `https://echo.test/view?uri=${uri}` },
      },
      {
        type: "resource_link",
        uri: `${uri}#scratch`,
        name: "scratch",
        annotations: { audience: ["assistant"] },
      },
    ],
  };
};

const reply = (request) => ({
  content: [
    {
      type: "text",
      text: `${request.params.name}(${JSON.stringify(request.params.arguments ?? {})})`,
    },
  ],
});

if (process.env.MCP_ECHO_PROMPTS) {
  // `MCP_ECHO_PROMPT_PAGE` pages the listing that many to a page, with the next offset as the
  // cursor: a client that reads one page sees the first few templates as all of them.
  const pageSize = Number(process.env.MCP_ECHO_PROMPT_PAGE) || prompts.length;
  server.setRequestHandler(ListPromptsRequestSchema, (request) => {
    const start = Number(request.params?.cursor ?? 0);
    const end = start + pageSize;
    return {
      prompts: prompts.slice(start, end),
      ...(end < prompts.length ? { nextCursor: String(end) } : {}),
    };
  });
  server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const messages = expand[request.params.name];
    if (!messages) {
      throw new Error(`no prompt named ${request.params.name}`);
    }
    return { messages: messages(request.params.arguments ?? {}) };
  });
}

if (process.env.MCP_ECHO_COMPLETIONS) {
  server.setRequestHandler(CompleteRequestSchema, (request) => {
    const values = completions(request.params.argument, request.params.context);
    return { completion: { values, total: values.length, hasMore: false } };
  });
}

if (process.env.MCP_ECHO_RESOURCES) {
  server.setRequestHandler(ReadResourceRequestSchema, (request) => ({
    contents: [resource(request.params.uri)],
  }));
}

await server.connect(new StdioServerTransport());
