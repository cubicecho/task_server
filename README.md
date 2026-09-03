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

The database is postgres, and with nothing configured it is an embedded one — PGlite, running
in the server's own process against `data/`. Nothing to install, nothing to start, and the
tables are created on first boot; see **Postgres**. Copy `.env.example` to `.env` if you want
to move the port, point at a postgres server, or supply the API key from the environment
instead of the UI.

## The model

- **task** — a name, a prompt, and optional per-task model and system prompt overrides. The
  prompt is the first thing that runs; anything after it is the task's flow.
- **step** — one node of that flow: its own prompt, optional model and system prompt, and how
  much of the run so far it is shown. A `decision` step also carries the cases it may choose
  between, and the steps that hang under each of them. See **Flows**.
- **trigger** — what starts a task. `kind: cron` fires on a schedule; `kind: event` fires when
  a `POST` arrives at `/webhooks/<its event id>` — see **Webhooks**.
- **run** — one execution: status, timings, output or error, which tools were called, tokens.
  A run in flight can be called off from either the Runs or the Tasks page (`stopTask`), which
  aborts the request and finishes the run as `stopped` — neither a success nor a failure.
  Neither the run nor its task can be deleted while it is going: both deletes are refused
  server-side until it has stopped. Expanding a running run on the **Runs** page shows it
  happening — see below.
- **run step** — what one step of the flow actually did on one run: its status, output, tools
  and tokens, and for a decision the arm it took. This is the record of the path a run took,
  and it survives the step being edited or deleted afterwards.
- **mcp server** — a stdio or http MCP server whose tools every run can reach, exposed to the
  model as `slug__tool-name`. The **MCP servers** page takes a `.mcp.json`-shaped paste and
  will dial a config (`testMcpServer`) to list its tools before you save it.
- **settings** — a single row: base URL, key, default model and system prompt, token and
  temperature limits, the cap on tool iterations per run, and how MCP tools are discovered.

## Flows

A task's prompt runs first. What follows it is a tree of steps, run depth-first and strictly in
order — the shape of Home Assistant's `choose`, with a model doing the choosing.

- An **agent step** is a full run of the agent loop: same tools, same iteration cap, its own
  prompt. Its answer joins the run's context and the next step sees it.
- A **decision step** is the same run, with one instruction appended: end with a line naming
  one of its cases. It can call tools to make up its mind — "check the last five emails, then
  say whether any of them report an error" is one step, not two. The arm it names runs next;
  the arms it did not name do not run at all. A decision that answers with nothing recognisable
  falls to its `default` arm if there is one, and fails the run if there is not — silently
  doing nothing is the worst possible thing to have to debug.

What a step is shown of the run so far is its `context`: `all` (default), `previous` — only the
step before it — or `none`. Where the prompt itself contains `{{previous}}` or
`{{steps.<name>}}`, the output goes exactly there and no preamble is added, so
`write {{previous}} to ~/notes/errors.md` puts the data where the sentence needs it.

`{{event}}` is the third of them and behaves differently: it is the body of the webhook that
started the run, pretty-printed, and it is not step context — so placing it says nothing about
where the earlier outputs go and does not suppress the preamble. A prompt may ask for both. In
a run no webhook started, or one whose body could not be read, it renders as
`(this run has no event payload)`. See **Webhooks**.

Flows are capped at 64 executed steps and 8 levels of nesting per run, which is what stops a
mis-parented tree from running away. Edit one on a task's page, either as cards or as YAML —
the two are the same tree, and the text tab keeps step ids, so a round trip through it leaves
the run history attached. Over the API it is one mutation, `setTaskSteps(taskId:, steps:)`,
which validates and writes the whole tree in a single transaction and refuses while the task is
running.

That mutation takes the tree nested — a decision carries its arms in `branches` — while `steps`
reads it back flat, as rows carrying `parentId` and `branch`. The two are not each other's
inverse, and the gap has a sharp edge worth knowing about before you write a client: those two
columns are not input fields, so a read handed straight back is refused, and a read handed back
with the unrecognised keys stripped out is *accepted* and arrives entirely at the top level,
which leaves each decision holding its `cases` with nothing under them. Nothing on the server
can tell that apart from a flow that was meant to be flat, so the `set_task_steps` tool
description says it outright and `tests/mcp-endpoint.test.ts` pins that it still does.

## Watching a run

A run row is a before and an after. Everything in between — the thinking, the tool the model
reached for, the argument it got wrong — is what you need when a task misbehaves, and it is
gone by the time the row is written. So the runner streams its completions and reports what it
is doing as it does it: reasoning and reply tokens, each tool call with its arguments, each
result, the turn boundaries of the agent loop, and which flow step each of them happened in —
the live view groups by step the same way the finished run does.

Those events go to an in-memory bus (`server/runner/events.ts`) and out over a GraphQL
subscription, `runEvents(runId:)`, which yoga serves as SSE — the browser reads it with its own
`EventSource`, so the client needs no library for it. Expand a running run on the **Runs** page
to watch. A watcher that joins halfway through is replayed the run so far, so opening it late
reads the same as having watched from the start.

It is debugging output, not the record: nothing is persisted, nothing survives a restart, and a
finished run is forgotten a minute later. The row remains the lasting account of what happened.

A run's status is `running`, then one of `ok`, `error` or `stopped` — and `skipped` for a row
that never ran at all, which is what a trigger firing at a task that was already running leaves
behind. Only `error` is a failure; the other three are outlined rather than coloured on the
**Runs** page for that reason.

A skipped row names the run it collided with in `blockedBy`, and counts the firings it stands
for in `attempts`: a sender posting faster than the task runs meets the same wall over and over,
and each of those bumps the existing row rather than adding another. Three hundred rows saying
one thing would bury the runs you opened the page to read.

Each run also shows what started it — the cron expression, or the webhook path — where it still
has a trigger to point at. Nothing is shown when it does not, because deleting a trigger clears
the reference and a run started by hand is then indistinguishable from one whose reason has been
thrown away.

With several servers connected, tool definitions cost more per request than the task's own
prompt — they are mostly JSON Schema, and every one is sent on every turn. Settings offers two
discovery modes (`runner/tool-loading.ts`):

- **eager** — every definition on every request. Simple, and fine with a handful of tools.
- **on demand** — the system prompt carries a name-only catalogue and the model calls
  `load_tools` for the schemas it wants, which arrive on the turn after. Names cost roughly a
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
  db/          drizzle schema and client; migrate.ts applies drizzle/ on boot
  graphql/     the schema: drizzle-graphql entities plus a few hand-written fields
  runner/      llm client, MCP pool, tool loading + schema compat, agent loop, flow, recorder
  scheduler/   node-cron, rebuilt from the triggers table on every relevant write;
               cleanup.ts prunes old runs hourly
  webhooks.ts  POST /webhooks/:id, which fires matching event triggers
  index.ts     express + yoga + the MCP endpoint + the webhook route + the built SPA
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

`features.nestedWrites` is off, so the UI saves a task and its triggers as separate mutations.
A flow is written by `setTaskSteps` rather than a row at a time in any case — see **Flows**.

## Webhooks

A trigger with `kind: event` carries an `event` id, and that id is the whole of its address:

```sh
curl -X POST http://localhost:8787/webhooks/nightly-import
```

The route always answers `200`, whether or not anything was listening — a caller learns
nothing about what exists here from the status code. What it started, and what it would not,
come back in the body:

```json
{
  "ok": true,
  "event": "nightly-import",
  "dispatched": [{ "taskId": "...", "name": "Import", "runId": "..." }],
  "refused": [
    { "taskId": "...", "name": "Sync", "runId": "...", "reason": "task \"Sync\" is already running" }
  ]
}
```

A post fires every enabled `event` trigger on an enabled task whose `event` matches exactly,
and returns as soon as those runs are started rather than waiting for them to finish. Watch
them on the **Runs** page like any other run.

A JSON body is the event's payload. It is handed to every task the post fires, kept on the run
row, shown under **Event payload** when you expand the run, and written into the prompt wherever
it says `{{event}}`:

```sh
curl -X POST http://localhost:8787/webhooks/nightly-import \
  -H 'content-type: application/json' -d '{"branch": "main"}'
```

```
Summarise what changed on {{event}} and write it to ~/notes/deploys.md
```

The server never looks inside it. A body is an argument to the event and never a condition of
it: one that is not JSON, is not declared as JSON, or is larger than 1 MB is a delivery with no
payload, not a failed delivery, and still answers `200` and still fires the task. A skipped run
keeps the payload too — a delivery that started nothing would otherwise leave no trace of what
was in it.

Only a task that actually started is in `dispatched`. A task already running is the refusal
worth expecting — anything that fires faster than it runs meets it routinely — and it is named
in `refused` with the reason. Both carry a `runId`, because both are written down: a delivery
that started nothing is recorded as a run of status **skipped**, so it appears on the **Runs**
page next to the run it collided with rather than only in the server's log. That is the whole
point of it. A trigger that fires into a wall and a trigger that is broken look identical from
the outside, and only one of them is worth investigating.

The same is true of a cron tick that lands on a task still running from the last one: it, too,
leaves a skipped run.

There is no signature, no secret, and no auth — the id is all there is, so pick one that is
not worth guessing if it matters. This is deliberate: the server is meant to sit somewhere you
already trust.

**Webhooks** on a task's edit page adds and removes them. **Add** generates an unguessable id
and shows the full URL to copy; **New id** replaces it, which is how a webhook is revoked — the
old address stops matching the moment the change is saved. The id is editable if you would
rather it read as something (`nightly-import`), at the cost of being guessable. A task can have
several, and several tasks can share one: a post fires all of them.

Every trigger, schedule and webhook alike, has its own switch beside it. Off is not deleted:
a silenced webhook keeps its id, so it can be armed again without the sender having to be
repointed, and a paused schedule is not one you have to remember to rebuild. The task's own
switch overrides all of them — disabling a task disables its triggers with it.

Both halves of a trigger are checked when it is written, over the UI or the API alike, because
either mistake produces the same thing — a row that looks armed and never runs. A cron
expression the scheduler cannot parse is refused, and so is an `event` trigger with no id.

## Retention

**Settings → Keep runs for** sets how many days of runs to keep. At `0`, the default, nothing
is ever deleted. Above zero, an hourly sweep — and one at boot — deletes runs that started
longer ago than that, along with their run steps. A run that is still going is never touched,
however old it is.

## MCP endpoint

`/mcp` serves this server's own API as MCP tools over Streamable HTTP, so another client —
Claude Code, Claude Desktop, anything that speaks MCP — can read and write tasks here without
going through the web app. In dev it is on the server's own port (`:8787`); vite proxies
`/graphql` alone.

```sh
claude mcp add --transport http tasks http://localhost:8787/mcp
```

Seventeen tools, chosen in `server/mcp-endpoint.ts` rather than projected from the whole schema:

- **read** — `tasks`, `steps`, `runs`, `run_steps`, `triggers`, `schedule`, `models`
- **write** — `create_task`, `update_task`, `delete_task`, and the same three for
  triggers, plus `set_task_steps` for a task's whole flow
- **run** — `run_task`, `stop_task`, `run_events`

Tool names are snake_case while the GraphQL fields they come from are camelCase: an MCP client
reads a tool name as a name, and snake_case is the convention it meets everywhere else. The
arguments and the fields in the answer are the schema's own, so they keep their spelling.

Six tools are marked `destructiveHint`: the two updates, `set_task_steps`, the two deletes, and
`stop_task`, which throws away whatever the run it aborts had done. The driver's own default
marks every mutation destructive, so creating a task would look the same to a client as dropping
one, and a client that stops to ask before a destructive call would spend that interruption in
the wrong place. `mutationHints: "byName"` reads the conventional `create`/`delete` prefixes off
the field name instead, which settles seven of the nine; `runTask` and `stopTask` are named after
neither and are corrected by hand.

`idempotentHint` follows from the same reading: the deletes land the same way twice, and so does
a second `stop_task`, which finds nothing in flight and says so. `run_task` does not, and that is
the one a client must not retry blind — running a task twice runs it twice.

The schema has forty-odd root fields, and the rest are left out on purpose: the settings row and
`setApiKey` (the server's own credentials are the operator's business, not a visiting agent's),
the MCP-server rows, the aggregates and group-bys, and every bulk mutation — `deleteTask` with
no `where` empties the table, where `deleteTaskSingle` cannot. Each tool selects one level of
fields, so a listing of tasks does not drag every run's output along with it.

The whole listing is about 155 kB, which is worth saying because it very nearly was not. The
generated filters reach through relations — a task filtered by its runs, each run filtered back by
its task — which costs nothing in the SDL, where a type is named rather than written out. As the
JSON Schema a tool advertises, a driver that rebuilds each type per route has to spell that
recursion out at every level: `tasks` alone came to 2.8 MB and the seventeen together to 18 MB,
some four and a half million tokens of tool definitions handed over before a client can call
anything. graphql-mcp 1.0.1 builds each input type once and emits a `$ref` for the repeats,
which is what made the surface readable at all. A test keeps it that way.

Two later changes took it from ~379 kB to ~155 kB, and both came out of measuring what agents on
this surface actually send. Across a hundred logged calls the only operator any of them used was
`eq`. drizzle-graphql 12 stopped generating the ones that cannot mean anything for the column —
`startsWith` on a boolean, `ilike` on a timestamp, ordering on a two-member enum — which is ~94
kB here. graphql-mcp 2.9.0's `inputField` then pruned the relation filters out of the projection,
another ~130 kB: `where: { triggers: { some: { event: { eq: "…" } } } }` was a question worth
being able to ask, and no agent ever asked it, so on this surface it is asked from the trigger
end instead, where `taskId` is a column. The pruning is on the projection alone — the same schema
object serves the web app, which still has every one of them.

A nullable argument used to be advertised twice over — absent from `required`, and carrying an
explicit `null` branch as well — and on a surface that is mostly generated filter types the
second was about a fifth of the bytes. It is now dropped from the reads and kept on the writes.
That split is the only version of the trade that works: on a mutation input the branch is how a
caller clears a column, and it is also how a model says "this optional is absent" — `"cases":
null` beside the fields it did fill in is the ordinary thing to write, and turning that into a
validation error is a worse surface than a larger one. On a `where` or an `orderBy` an explicit
null means nothing at all. Dropping it everywhere was tried first, and reverted.

Each argument whose type is an input object also carries a literal JSON example in its
description, as of 2.6.0 — `shape: {"id":{"eq":"string"}}` for a filter, `{"id":{"direction":
"asc","priority":0}}` for an `orderBy`. That is aimed squarely at the failure this surface
actually has: in the A/B runs behind the `HINTS` table, every failed call was an argument shape
guessed from the argument's *name*, and the right answer was in the JSON Schema the whole time —
inside 400 kB that nothing reads. The prose is what gets read, so the shape goes in the prose.

Unknown fields in a tool's arguments are rejected rather than dropped, as of 1.0.2: a misspelled
key comes back as `Unrecognized key: "order"` instead of a success with that part of the request
quietly discarded, which is the correction an agent can act on.

`run_task` does not answer until the run is over, which for a real task is minutes. To watch one
meanwhile, poll `run_events(runId, afterSeq)` — the snapshot form of the subscription the Runs
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
one container, the same as `npm start`. The embedded postgres keeps its data on the volume,
bind-mounted at `./data`, so the tasks survive the container.

For a postgres server of its own, `docker-compose.pg.yml` is the same image beside a
`postgres:17` service, with `DATABASE_URL` pointed at it and the tasks in a named volume:

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
version, to both `ghcr.io/<owner>/<repo>` and Docker Hub. GHCR authenticates with the built-in
`GITHUB_TOKEN`, so it is never a setup step. Docker Hub is the optional half: it authenticates
with `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`, which the organisation shares with this repo,
and when they are missing the workflow drops those two tags and publishes to GHCR alone rather
than failing. Worth knowing, because it is not obvious: an organisation secret on the free plan
is readable from public repositories only, so a private repo sees them as empty.
Only `feat:`/`fix:` commits produce a version, so the Release workflow also takes a manual run
with a version typed in, which publishes the images without tagging a release.

## Codegen

The schema is built at runtime from the tables, so codegen needs it written out first:

```sh
npm run codegen    # prints schema.graphql, then generates src/gql/
```

That produces `src/gql/graphql.ts`: a typed document node per operation, so a query whose
shape changes breaks compilation rather than at runtime.

In development you rarely run it by hand, because both halves of `npm run dev` keep it current
from the side they can see:

- the **server** rewrites `schema.graphql` on boot, and regenerates the types with it — that is
  the moment after a table changes, and it only does the work when the SDL actually moved
- **vite** watches `schema.graphql` and `src/graphql/**/*.graphql` through
  `vite-plugin-graphql-codegen`, so editing a document regenerates its typed node and hot-reloads

Both are dev-only. The production image has no codegen in it and nothing to regenerate: it
serves a `dist/` that was built against the types it was typechecked with.

`npm run build` runs codegen before the typecheck, so a stale `src/gql/graphql.ts` cannot reach
a build. CI additionally regenerates and diffs against what is committed — the artefacts are
generated *and* checked in, and that step is what stops the two from drifting apart.

## Postgres

Postgres is the only database, and it comes in two shapes.

With nothing set, the server runs **PGlite**: postgres itself, compiled to WebAssembly and
running inside the Node process against a directory under `data/`. A fresh clone has a database
the moment it boots, with nothing installed and nothing to start — and it is the same engine,
the same SQL and the same types as the deployed thing, which is the point of it. The tests run
one in memory, a throwaway per suite.

With `DATABASE_URL` set it is a postgres server over `pg`, for the deployment that has outgrown
a single process — more than one server, a managed backup, storage that is not the app's own
disk.

```sh
DATABASE_URL=postgres://tasks:tasks@localhost:5432/tasks npm start
```

That variable is the whole switch, and `server/db/client.ts` is the only place in the server
that acts on it — everything above `server/db/` is written against one `db` and one set of
tables. The schema is created on first boot either way, so an empty database is all a postgres
server has to arrive with; `docker-compose.pg.yml` is the same image against a `postgres:17`
service — see **Docker** above.

The schema comes from the migrations committed in `drizzle/`, which `server/db/migrate.ts`
applies on boot against either database. Changing `server/db/schema.ts` means running
`npm run db:generate` and committing the migration it writes.

It is a swap, not a migration: the two databases share no data, and moving tasks from one to
the other is your own `pg_dump`-shaped problem.

`npm run db:generate`, `db:migrate` and `db:studio` follow `DATABASE_URL` too.

## Scripts

| | |
| --- | --- |
| `npm run dev` | server and web together |
| `npm run build` | typecheck, then build the SPA into `dist/` |
| `npm start` | production: express serves `dist/` and the API on one port |
| `npm run codegen` | print `schema.graphql` and regenerate `src/gql/` |
| `npm test` | vitest |
| `npm run lint` / `format` | biome |
| `npm run db:generate` | write a migration into `drizzle/` after a schema change |
| `npm run db:migrate` | apply `drizzle/` by hand; the server does it on boot anyway |
| `npm run db:studio` | drizzle studio |
