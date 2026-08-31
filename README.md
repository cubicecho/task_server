# task-server

Scheduled AI tasks. You write a prompt, attach a cron trigger, and the server runs it against
an OpenAI-compatible model with your MCP servers' tools attached — keeping the output of every
run.

It is the shape of [min-agent](../../min-agent) with the chat taken out: there is no
conversation here, only tasks that fire on their own.

## Quick start

```sh
npm install
npm run dev        # express on :8787, vite on :3000
```

Open <http://localhost:3000>, go to **Settings**, point *Base URL* at any OpenAI-compatible
server (Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`, OpenAI,
OpenRouter), pick a model, and save. Then create a task, give it a cron expression, and hit
**Run now** to try it without waiting for the clock.

The SQLite file is created on first boot under `data/`; there is no migration step to run.
Copy `.env.example` to `.env` if you want to move the port, the database, or supply the API key
from the environment instead of the UI.

## The model

- **task** — a name, a prompt, and optional per-task model and system prompt overrides.
- **trigger** — what starts a task. `kind: cron` is the only one that fires today; `kind:
  event` exists as the row shape for the next step (a new email, a webhook), and is stored but
  never dispatched.
- **run** — one execution: status, timings, output or error, which tools were called, tokens.
  A run in flight can be called off from either the Runs or the Tasks page (`stopTask`), which
  aborts the request and finishes the run as `stopped` — neither a success nor a failure.
  Neither the run nor its task can be deleted while it is going: both deletes are refused
  server-side until it has stopped. Expanding a running run on the **Runs** page shows it
  happening — see below.
- **mcp server** — a stdio or http MCP server whose tools every run can reach, exposed to the
  model as `slug__tool-name`. The **MCP servers** page takes a `.mcp.json`-shaped paste and
  will dial a config (`testMcpServer`) to list its tools before you save it.
- **settings** — a single row: base URL, key, default model and system prompt, token and
  temperature limits, the cap on tool iterations per run, and how MCP tools are discovered.

## Watching a run

A run row is a before and an after. Everything in between — the thinking, the tool the model
reached for, the argument it got wrong — is what you need when a task misbehaves, and it is
gone by the time the row is written. So the runner streams its completions and reports what it
is doing as it does it: reasoning and reply tokens, each tool call with its arguments, each
result, and the step boundaries between them.

Those events go to an in-memory bus (`server/runner/events.ts`) and out over a GraphQL
subscription, `runEvents(runId:)`, which yoga serves as SSE — the browser reads it with its own
`EventSource`, so the client needs no library for it. Expand a running run on the **Runs** page
to watch. A watcher that joins halfway through is replayed the run so far, so opening it late
reads the same as having watched from the start.

It is debugging output, not the record: nothing is persisted, nothing survives a restart, and a
finished run is forgotten a minute later. The row remains the lasting account of what happened.

With several servers connected, tool definitions cost more per request than the task's own
prompt — they are mostly JSON Schema, and every one is sent on every step. Settings offers two
discovery modes (`runner/tool-loading.ts`):

- **eager** — every definition on every request. Simple, and fine with a handful of tools.
- **on demand** — the system prompt carries a name-only catalogue and the model calls
  `load_tools` for the schemas it wants, which arrive on the step after. Names cost roughly a
  fortieth of what the schemas do. Before the run starts, an optional small **tool-picking
  model** reads the same catalogue and guesses the tools the task needs; when it guesses well
  the first step opens with that shortlist alone — no catalogue, no `load_tools`, no extra
  round trip. A wrong guess only costs an unused definition for one run, and the model can
  still load whatever it actually wanted.

MCP tool schemas are normalised before they reach the model (`runner/schema-compat.ts`):
llama.cpp-backed servers compile every tool into one grammar, so a single shape their
converter dislikes — a `type: ["string", "null"]`, a lookaround `pattern`, a bare type name
where a schema belongs — fails the whole request rather than the one tool. If the server still
reports a grammar failure, the advisory `pattern` and `format` keywords are dropped and the
call is retried once. Cloud providers accept all of it, so the retry never fires against them.

Disabling a task disables its triggers with it — the switch on the task is what a user reaches
for to make it stop.

## Layout

```
server/
  db/          drizzle schema, client, and the boot-time CREATE TABLE IF NOT EXISTS
  graphql/     the schema: drizzle-graphql entities plus a few hand-written fields
  runner/      llm client, MCP pool, tool loading + schema compat, agent loop, recorder
  scheduler/   node-cron, rebuilt from the triggers table on every relevant write
  index.ts     express + yoga + the MCP endpoint + the built SPA
src/           vite + react + tanstack router/query + shadcn
               (tasks, runs, mcp servers, settings)
tests/         vitest
```

## GraphQL

The API is generated from the Drizzle tables by
[`@vantreeseba/drizzle-graphql`](https://github.com/vantreeseba/drizzle-graphql), so a new
column is queryable as soon as it exists. Hand-written fields fill the gaps that CRUD cannot
express: `models`, `mcpStatus`, `schedule` and `runEvents` on the query side, `runTask`,
`stopTask`, `reconnectMcp` and `setApiKey` on the mutation side.

- **`POST /graphql`** — the API, plus GraphiQL in a browser.
- **`/mcp`** — the same server offered to agents as MCP tools; see below. Not for the web app,
  which talks only GraphQL.

Writes go through `onWrite` hooks that rebuild the cron schedule and reconcile the MCP pool, so
editing a trigger in the UI takes effect immediately.

`features.nestedWrites` is off: it needs an asynchronous SQLite driver, and this app uses Node's
synchronous built-in `node:sqlite` to stay free of native dependencies. The UI therefore saves a
task and its triggers as separate mutations.

## MCP endpoint

`/mcp` serves this server's own API as MCP tools over Streamable HTTP, so another client —
Claude Code, Claude Desktop, anything that speaks MCP — can read and write tasks here without
going through the web app. In dev it is on the server's own port (`:8787`); vite proxies
`/graphql` alone.

```sh
claude mcp add --transport http tasks http://localhost:8787/mcp
```

Fourteen tools, chosen in `server/mcp-endpoint.ts` rather than projected from the whole schema:

- **read** — `tasks`, `runs`, `triggers`, `schedule`, `models`
- **write** — `createTask`, `updateTaskSingle`, `deleteTaskSingle`, and the same three for
  triggers
- **run** — `runTask`, `stopTask`, `runEvents`

The schema has forty-odd root fields, and the rest are left out on purpose: the settings row and
`setApiKey` (the server's own credentials are the operator's business, not a visiting agent's),
the MCP-server rows, the aggregates and group-bys, and every bulk mutation — `deleteTask` with
no `where` empties the table, where `deleteTaskSingle` cannot. Each tool selects one level of
fields, so a listing of tasks does not drag every run's output along with it.

`runTask` does not answer until the run is over, which for a real task is minutes. To watch one
meanwhile, poll `runEvents(runId, afterSeq)` — the snapshot form of the subscription the Runs
page uses, with consecutive thinking and output tokens folded into one entry each. Pass the
`seq` of the last entry you read as `afterSeq` and you get what came after it, and nothing
twice.

It is stateless: each request builds its own server and answers as JSON, so there is no session
to keep alive and a client can reconnect whenever it likes. The endpoint is mounted for every
method, not just `POST`, so the `GET` a client uses to offer a notification stream and the
`DELETE` it uses to end a session are answered by the transport in JSON-RPC rather than by
Express's 404 page.

No CORS headers, deliberately: this server has no authentication, so anyone who can reach the
port can drive it, and there is no reason to also let a web page from another origin do so.

## Codegen

The schema is built at runtime from the tables, so codegen needs it written out first:

```sh
npm run codegen    # prints schema.graphql, then generates src/gql/
```

That produces `src/gql/graphql.ts`: a typed document node per operation, so a query whose
shape changes breaks compilation rather than at runtime. Re-run it after changing a table or a
`.graphql` document in `src/graphql/`.

## Postgres

Only SQLite is wired up. The swap is confined to `server/db/client.ts`, which throws on a
non-`file:` `DATABASE_URL` pointing at itself; the table definitions in `server/db/schema.ts`
would move to `drizzle-orm/pg-core`.

## Scripts

| | |
| --- | --- |
| `npm run dev` | server and web together |
| `npm run build` | typecheck, then build the SPA into `dist/` |
| `npm start` | production: express serves `dist/` and the API on one port |
| `npm run codegen` | print `schema.graphql` and regenerate `src/gql/` |
| `npm test` | vitest |
| `npm run lint` / `format` | biome |
| `npm run db:studio` | drizzle studio |
