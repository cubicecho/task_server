# task-server

Scheduled AI tasks. You write a prompt, attach a cron trigger, and the server runs it against
an OpenAI-compatible model with your MCP servers' tools attached — keeping the output of every
run.

It is the shape of min-agent with the chat taken out: there is no conversation here, only
tasks that fire on their own.

## Quick start

```sh
git clone git@github.com:cubicecho/task_server.git
cd task_server
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

## Docker

```sh
docker compose up --build
```

The server is on `http://localhost:8787` — the dashboard, `/graphql`, and `/mcp` all from the
one container, the same as `npm start`. The database is a file on the volume, bind-mounted at
`./data`, so the tasks survive the container and can be copied somewhere else.

For postgres instead, `docker-compose.pg.yml` is the same image beside a `postgres:17` service,
with `DATABASE_URL` pointed at it and the tasks in a named volume:

```sh
docker compose -f docker-compose.pg.yml up --build
```

Nothing in the image changes between the two — see **Postgres** below.

Set `TZ` in a `.env` beside the compose file if cron triggers should fire on your clock rather
than UTC. `OPENAI_API_KEY` is optional and only a fallback: the key the settings screen saves
lives in the database and wins.

The image builds the client with the dev dependencies and then throws them away, and the
runtime stage has no `tsx` in it — Node runs the server's TypeScript by stripping the types.
That is the one thing about the image that could break on a source change, so CI builds it,
boots it, and asks it a question on every pull request.

Releases are cut from the commit log by semantic-release and push four tags — `latest` and the
version, to both `ghcr.io/<owner>/<repo>` and Docker Hub. That needs `DOCKERHUB_USERNAME` and
`DOCKERHUB_TOKEN` as repository secrets; GHCR authenticates with the built-in `GITHUB_TOKEN`.
Only `feat:`/`fix:` commits produce a version, so the Release workflow also takes a manual run
with a version typed in, which publishes the images without tagging a release.

## Codegen

The schema is built at runtime from the tables, so codegen needs it written out first:

```sh
npm run codegen    # prints schema.graphql, then generates src/gql/
```

That produces `src/gql/graphql.ts`: a typed document node per operation, so a query whose
shape changes breaks compilation rather than at runtime. Re-run it after changing a table or a
`.graphql` document in `src/graphql/`.

## Postgres

SQLite is the default and needs nothing: `node:sqlite` is built into Node, so a fresh clone
has a database the moment it boots. Postgres is one environment variable away, for the
deployment that has outgrown a file — more than one server process, a managed backup, storage
that is not the app's own disk.

```sh
DATABASE_URL=postgres://tasks:tasks@localhost:5432/tasks npm start
```

The URL's scheme is the whole switch. The tables are created on first boot exactly as they are
for a new SQLite file, so an empty database is all postgres has to arrive with, and
`docker-compose.pg.yml` is the same image against a `postgres:17` service — see **Docker**
above.

It is a swap, not a migration: the two databases share no data, and moving tasks from one to
the other is your own `pg_dump`-shaped problem.

Three files know which database it is, and nothing above `server/db/` does:

- **`dialect.ts`** reads `DATABASE_URL` and answers `sqlite` or `postgres`. An unrecognised
  scheme throws rather than guessing.
- **`schema.ts`** picks between `schema.sqlite.ts` and `schema.pg.ts` — the same tables twice,
  once in each dialect. `boolean` for an integer 0/1, `timestamptz` for epoch milliseconds,
  `jsonb` for JSON in a `text` column: different storage, identical JavaScript values coming
  back. So the postgres tables are handed out under the SQLite tables' *types*, and the
  runner, the GraphQL layer and the tests are written once against one `Task`.
- **`client.ts`** opens `node:sqlite` or a `pg` pool, and `migrate.ts` runs the matching DDL.

Two schemas is the cost of the arrangement, and the risk is that they drift: a column added to
one and forgotten in the other typechecks, passes every other test, and fails at runtime on
whichever database the author was not using. `tests/schema-parity.test.ts` compares them
column by column — names, nullability, defaults — and fails CI when they disagree.

`npm run db:push` and `db:studio` follow `DATABASE_URL` too, and write their diffs to
`drizzle/<dialect>/`.

The GraphQL API does not change with the database — the same queries, the same generated
client — with one exception: postgres can filter JSON by containment, so running `npm run
codegen` against a `postgres://` URL adds `contains` to `JSONFilter`. The committed
`schema.graphql` is the SQLite one and nothing in the app uses that filter, so that is a diff
to throw away rather than commit.

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
