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
- **agent profile** — a named set of overrides for that settings row, which a task can be
  pointed at: its own endpoint and key, model, system prompt, ceilings, and which MCP servers a
  run on it may reach. Everything left blank comes from settings, so a server with no profiles
  runs exactly as one that never had them. See **Agent profiles**.
- **settings** — a single row: base URL, key, default model and system prompt, token and
  temperature limits, the cap on tool iterations per run, and how MCP tools are discovered.

## Agent profiles

One settings row is the right answer until it is not: a summariser that should run on a cheap
local model, a task that has to reach a hosted one, a nightly job that may spend an hour of
retries where the rest may not. A **profile** is that bundle, made once and pointed at by as many
tasks as want it — `tasks.agentId`, null on a task that runs on settings, which is every task
until somebody makes a profile.

A profile does not add a second thing the runner reads. `server/runner/profile.ts` lays it over
the settings row and hands the result to the run, so the agent loop, the flow and the LLM client
see one `Settings` object exactly as they always did.

Blank is inherit, and the sentinels differ by column because zero is a real answer for most of
them: `""` for a text column, `-1` for a number — zero retries, zero seconds of patience and zero
tokens all mean something — and the word `inherit` for tool discovery. The form on the **Agents**
page shows an inherited number as an empty box.

The one column that is not a plain override is the key. A profile that names a `baseUrl` of its
own never inherits the server's API key or `$OPENAI_API_KEY`: a credential issued for one
endpoint has no business being posted to another, and "I pointed a task at a friend's server and
it sent my OpenAI key" is not a mistake worth being able to make. Such a profile uses its own key
or none, which is what a local server wants anyway. A profile on the *same* endpoint inherits the
key like everything else. The key is write-only in both places — `setAgentApiKey` writes it, and
it is excluded from the `Agent` type, so it cannot be read back out of the API.

`mcpServerIds` is which MCP servers a run on the profile may reach, and an empty or absent list is
every enabled server. It is a scope, not a listing: a tool outside it is refused by
`mcp.call` as one that does not exist, so a model that remembers a name from a wider run does not
reach it either. Which *tools* of a server a task may use is deliberately not here — that is what
a router endpoint in front of them is for, and scope written twice is scope that disagrees.

Profiles are the operator's, on both sides of the API: a visiting agent on `/mcp` can see that a
task runs on one — `agentId` is a column like any other — but cannot read a profile, write one,
or point a task at a different one. They carry an endpoint, a key and the tool scope, which is
the settings row's own argument. See **Permissions**.

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

A run's status is `running`, then one of `ok`, `error` or `stopped`. Two more are rows that have
not run: `queued` is a firing waiting for a free slot, which becomes `running` in that same row
when one comes back, and `skipped` never ran at all — a trigger that fired at a task that could
not start. Only `error` is a failure; the other four are outlined rather than coloured on the
**Runs** page for that reason.

A skipped row names the run that was in the way in `blockedBy`, and counts the firings it stands
for in `attempts`: a sender posting faster than the task runs meets the same wall over and over,
and each of those bumps the existing row rather than adding another. Three hundred rows saying
one thing would bury the runs you opened the page to read.

### How many at once

**Runs at once** in **Settings** (`maxConcurrentRuns`, four by default) is the ceiling across
every task, not per task. The per-task rule is separate and absolute: one run of a task at a
time, however much room is left. The ceiling exists because a run is a model call with every MCP
server's tools attached, and a dozen tasks whose crons share a minute will happily start twelve
of those at once — into one API key's rate limit, one machine's memory, and whatever the stdio
servers spawn. Zero lifts it, for a server where something else is doing the limiting.

A firing that arrives with no slot free waits: it is written down as a `queued` run, which starts
by itself in that same row the moment a slot comes back. Nothing about it has failed — every
slot is spoken for this minute and will not be the next — and the difference between a task that
ran late and a task that did not run is the whole of why the queue is there. One row per waiting
trigger, not per firing, so a sender posting every second at a full server does not build a queue
that takes an hour to drain; `attempts` counts the deliveries it stands for, and it runs once,
with the newest of their bodies. Deleting the row is how you call it off, and a task disabled
while its firing waited does not run — "stop firing this" honoured minutes late is not honouring
it.

A firing that meets *its own task* still running is a different fact, and is still turned away:
a `skipped` run saying so, with the run in the way as its `blockedBy`. The work is already in
flight, and queueing a second copy behind it is how a five-minute task ends up running twelve
times over an hour it was never meant to. So is a person or an agent pressing **Run now** at a
full server — they are asking for a run now and are told on the spot, rather than handed a row
that starts at some point they are not watching.

Both show on the **Runs** page, and **Status** keeps them apart: a refusal gathers the task under
**Turned away**, a firing still queued under **Waiting**. Waiting is not a fault — it says the
ceiling is low for what is pointed at this server, or that a task is slower than its schedule —
and it is worth seeing before the queue is where the work lives.

Each run also shows what started it — the cron expression, or the webhook path — where it still
has a trigger to point at. Nothing is shown when it does not, because deleting a trigger clears
the reference and a run started by hand is then indistinguishable from one whose reason has been
thrown away.

### Finding one again

Retention defaults to keeping every run forever, so the history outgrows a page of it quickly.
The **Runs** page filters by status, by task and by how far back to look, and searches the
output, the error and the task's name at once — the three places the thing you half remember
could have been written. It is `ilike` through the generated `where`, not an index: no column
was added and no library is involved, and the same filters were already there for anything else
that asks this schema a question.

The list grows a page at a time rather than paging by offset, because rows arrive at the top
while you read and an offset over a list being prepended to shows one run twice and skips
another. For the same reason the five-second poll runs only on the newest page unfiltered:
once you are searching or have loaded more, new rows would move what you are reading, and a
poll behind a search re-scans every run that was ever kept. **Refresh** is the way back to live.

The controls are the page's, but the question is the server's, so `web/lib/run-filters.ts`
holds the builder on its own and `tests/run-history.test.ts` puts what it builds — and the
document the browser sends, printed rather than retyped — against a real database. Whether an
escaped `%`, an enum `eq` and an `OR` across a relation mean what the controls say they mean is
a question about SQL, and nothing in the browser can answer it.

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

## Is anything wrong

The **Status** page answers that and nothing else. It is seven tiles counting tasks, and a list
of the ones something is wrong with.

The words on the tiles are deliberately not the run statuses. `ok`, `error` and `stopped`
describe one run; what a person opening this page wants is what is true of the *task* now, and
three of the answers worth having are not run statuses at all:

- **Turned away** — a trigger fired while the task was still running, and nothing has run since.
  The firings in between were refused and left `skipped` rows, which is exactly what those rows
  are for. The tile counts the tasks; the row says how many deliveries the collision stands for.
  A webhook posted faster than its task runs looks perfectly healthy on the Tasks page, because
  its last run finished fine.
- **Waiting** — a firing found the server at its limit and is queued. Nothing has failed and
  nothing is lost, and the task is still behind by a delivery it has not run yet; the last run
  finished cleanly and says nothing about the one it owes.
- **Manual only** — enabled, and nothing arms it. It runs when you press play and not otherwise.
  This never fails and never appears in the run history, and on the Tasks page it is
  indistinguishable from a task that is working.

The other four are **Broken** (the last run errored), **Running**, **Off** (disabled), and
**Fine**. A task is in exactly one heap: collisions outrank everything, because a task that is
falling behind is nearly always also running, and ranking `running` first would hide every one
of them behind the fact that it is busy. `broken` outranks `off` for a related reason — turning
a task off is not the same as having fixed it. Only **Turned away** and **Broken** are listed
when no tile is picked, because only those two are something to fix; **Waiting** is the server
doing what it was told, reported so that a ceiling set too low does not go unnoticed.

Two things below the list are not about tasks at all. **Servers that did not connect** reads
`mcpStatus`, because an enabled MCP server that failed to connect means every run since went out
with fewer tools than its prompt was written for, and nothing else in the app says so without
opening the servers page. **Failures with nothing standing behind them** is the recent `error`
runs whose task has since run cleanly, or whose task is gone: the tiles cannot count those,
since the task now looks well, and a failure is worth seeing once even after something has
papered over it.

Which heap a task is in is decided in `web/lib/task-health.ts` rather than in the page, for the
reason [Finding one again](#finding-one-again) gives about the run filter: `tests/status.test.ts`
seeds a task per answer, runs the printed `StatusDocument` against a real database, and asks the
same function the browser asks. The case that earns the test is *recovered* — a task with a
skipped row older than its last run, which a rule that only asked whether a skipped row exists
would call behind when it has caught up.

## Layout

```
server/
  db/          drizzle schema and client; migrate.ts applies drizzle/ on boot
  graphql/     the schema: drizzle-graphql entities plus a few hand-written fields;
               permissions.ts says who may call what, applied to the schema itself;
               docs.ts is the one copy of what every column means
  runner/      llm client, MCP pool, tool loading + schema compat, agent loop, flow, recorder
  scheduler/   node-cron, rebuilt from the triggers table on every relevant write;
               cleanup.ts prunes old runs hourly
  webhooks.ts  POST /webhooks/:id, which fires matching event triggers
  index.ts     express + yoga + the MCP endpoint + the webhook route + the built SPA
web/           vite + react + tanstack router/query/form + shadcn and @cubeui shells
               (status, tasks, runs, mcp servers, agents, settings)
  __generated__/  codegen output, gitignored — see GraphQL below
tests/         vitest
```

## GraphQL

The API is generated from the Drizzle tables by
[`@vantreeseba/drizzle-graphql`](https://github.com/vantreeseba/drizzle-graphql), so a new
column is queryable as soon as it exists. Hand-written fields fill the gaps that CRUD cannot
express: `models`, `mcpStatus`, `schedule` and `runEvents` on the query side, `runTask`,
`stopTask`, `reconnectMcp`, `setApiKey` and `setAgentApiKey` on the mutation side.

- **`POST /graphql`** — the API, plus GraphiQL in a browser.
- **`/mcp`** — the same server offered to agents as MCP tools; see below. Not for the web app,
  which talks only GraphQL.

One schema, two doors, and one set of rules over both — see **Permissions**.

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
  "queued": [
    { "taskId": "...", "name": "Digest", "runId": "...", "reason": "4 runs already going, and the limit is 4" }
  ],
  "refused": [
    { "taskId": "...", "name": "Sync", "runId": "...", "reason": "task \"Sync\" is already running" }
  ]
}
```

A post fires every enabled `event` trigger on an enabled task whose `event` matches exactly,
and returns as soon as those runs are started — or written down as waiting — rather than
waiting for them to finish. Watch them on the **Runs** page like any other run.

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
payload, not a failed delivery, and still answers `200` and still fires the task. A skipped or
queued run keeps the payload too — one is a delivery that started nothing and would otherwise
leave no trace of what was in it, the other is the body the run will be given when its turn
comes.

A `config` column on the trigger once held matching rules for exactly this — free-form JSON the
server would test a body against before firing. It was dropped rather than finished, because it
contradicts the line above: rules are the payload being a condition. While it existed an agent
could read its description, set rules on a trigger, and get no error and no effect.

### Running one by hand

A body is not only a sender's to provide. **Run again with this body** on an expanded run
replays the payload it was given, and pressing play on a task that has a webhook asks for one
first, prefilled with the last body that task saw. Both open the same box, and what is in it is
what the prompt reads as `{{event}}`.

The two things that fixes were the same thing from either end. A delivery that failed left its
body on the run row and nothing that could hand it back, so the only way to try a fix was to ask
the sender to send again — and a sender that fires on a merge does not oblige. A prompt with
`{{event}}` in it could not be tried at all before a sender existed: the first honest test of the
template was in production, or it was `curl` and a trigger id copied by hand.

A run started this way names no trigger. It is a hand-started run that happens to have a body,
and one that claimed the webhook it was copied from would put a delivery in the history that
nobody sent. Over GraphQL and `/mcp` it is the same argument — `runTask(taskId:, payload:)` —
so an agent can replay a failed delivery as well as read about it.

Only a task that actually started is in `dispatched`. The other two arrays are the deliveries
that arrived perfectly well and did not become a run there and then. A task already running is
the refusal worth expecting — anything that fires faster than it runs meets it routinely — and
it is named in `refused` with the reason. One that found the server at its limit is in `queued`
instead, and the distinction is not cosmetic: that one is going to run, in the row named here,
as soon as a slot comes back.

All three carry a `runId`, because all three are written down: a delivery that started nothing
now is recorded as a run of status **skipped** or **queued**, so it appears on the **Runs** page
next to the run it collided with rather than only in the server's log. That is the whole point
of it. A trigger that fires into a wall and a trigger that is broken look identical from the
outside, and only one of them is worth investigating.

The same is true of a cron tick that lands on a task still running from the last one, or on a
server with no slot free: it leaves a skipped run for the first and a queued one for the
second.

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

### The surface that was measured against this one

A spike put a second endpoint beside this one, `/mcp-docs`, built from hand-written GraphQL
operations rather than projected root fields: the tool was the operation, its arguments were the
operation's flat named variables, and its description was the comment block above it. Sixteen
tools in ~25 kB, against seventeen in ~155 kB here, and ~60% of those bytes prose an agent reads
rather than schema it skims, against ~9% on this one.

Fifteen isolated agents — five errands across three surfaces, each with its own fixture server
and database, writes verified against the tables rather than taken on the agent's word — got
5/5 errands right on every surface, with no failed calls on any of them. So the smaller listing
bought no accuracy that this one did not already have, and it cost a curated API: a new column
is unreachable until somebody writes a document asking for it, and every document is a file to
keep in step with the schema. The generated surface is what stayed.

What the spike did leave behind is here rather than there. The listing went from ~379 kB to
~155 kB on two upstream changes filed off those runs, both above, and the reads gave up their
null branches. Across a hundred logged calls the only filter operator any agent sent was `eq`,
which is the finding both of those act on.

## Permissions

`TOOLS` above is a listing, not a lock. The seventeen tools are what a visiting agent is *told
about* — the settings row, the MCP server rows and every bulk write were left out of it on
purpose — but both endpoints are one schema in one process, so nothing about that list decided
what an agent could *reach*. `server/graphql/permissions.ts` is that decision, written once with
[`@vantreeseba/graphql-casl`](https://github.com/cubicecho/graphql-casl) and applied to the
schema itself rather than to either endpoint, which is what makes it true of both.

There are no accounts and there is no token. What there is instead is two doors used by two
different kinds of thing: `/mcp` is where agents call in and `/graphql` is where the web app
does, and each says which it is when it builds the context. A request with no context at all —
a test calling `graphql()`, this server executing its own schema in process — is the operator.

The operator may do anything; the web app is the whole of the API. An agent writes and runs
tasks: it makes them, edits their flows with `setTaskSteps`, schedules them, starts and stops
them, and reads what happened. Four things it may not touch:

- **The settings row.** The operator's account of their own server — endpoint, model, key.
  `setApiKey` writes a credential, and an agent that could repoint `baseUrl` would have
  redirected every future run to a server of its choosing. Guarded in all four of the ways a
  generated schema offers a table, because `settingsGroupBy(groupBy: [baseUrl])` answers with the
  same values under a different heading.
- **The MCP server rows.** `env` and `headers` on one of those are credentials in all but name,
  and `testMcpServer` spawns whatever stdio command it is handed, so it is arbitrary execution on
  this host for anyone who reaches it.
- **The agent profiles.** The settings row again in miniature, one per profile: an endpoint, a
  key, and which MCP servers a task on it may reach. An agent that could write one could point a
  task at a model of its choosing and hand it every tool this server has. A task still carries
  its `agentId`, so a visiting agent can see that a task runs on a profile — it just cannot
  choose or change which, or read what the profile says.
- **The run history.** An agent tidying away the run that recorded what it did is the one edit
  nobody can audit afterwards.

Mutations are a whitelist — `"*": deny` at the head of the map — so a write added by a new table
ships shut rather than open, and so does every bulk form. That last part holds for the operator
too: `deleteTask` with no `where` empties the table where `deleteTaskSingle` cannot, and every
document under `web/graphql/` already uses a single-row form, so shutting them costs no caller
anything.

Two tests keep it honest. `tests/permissions.test.ts` asks the schema as each caller and checks
what comes back, and it also runs every rule named in `TOOLS` as an agent: a field added to the
listing that the map denies would otherwise be a tool that is advertised, called, and refuses
every time, which an agent cannot tell from a broken server.

What this does *not* buy, today: `/graphql` has no authentication, so it is the operator's door
by definition, and anyone who can reach the port is the operator. The split earns its keep on
`/mcp`, where it is defence in depth under a surface that already offers only seventeen tools,
and it is what a shared token would switch on — a `Bearer` header on `/graphql` would then be an
agent that found the query endpoint, held to an agent's rules there as it is here.

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
npm run codegen    # prints schema.graphql, then generates web/__generated__/
```

That produces two files. `web/__generated__/graphql/graphql.ts` is a typed document node per
operation, so a query whose shape changes breaks compilation rather than at runtime;
`descriptions.ts` is the schema's field descriptions as a runtime map — see **Field
descriptions** below. It is gitignored rather
than committed — nothing reads it but the typechecker and the bundler, and both regenerate it
themselves, so a stale copy checked in could only go stale silently instead of being caught.

You rarely run it by hand: `npm run typecheck` and `npm run build` both regenerate it first, and
in development both halves of `npm run dev` keep it current from the side they can see:

- the **server** rewrites `schema.graphql` on boot, and regenerates the types with it — that is
  the moment after a table changes, and it only does the work when the SDL actually moved
- **vite** watches `schema.graphql` and `web/graphql/**/*.graphql` through
  `vite-plugin-graphql-codegen`, so editing a document regenerates its typed node and hot-reloads

Both are dev-only. The production image has no codegen in it and nothing to regenerate: it
serves a `dist/` that was built against the types it was typechecked with, and `npm start` never
calls `runCodegen`.

`schema.graphql` itself is the one artefact still committed, because it is the schema the API
actually serves and worth reading without running anything. CI regenerates it and diffs against
what is committed, so a table changed without a `npm run schema` is caught as drift rather than
a puzzling type error two steps later.

## Field descriptions

Every column's description is written once, in `server/graphql/docs.ts`, and read three ways.

It used to be written twice and reach nobody twice over. The prose was JSDoc on the column in
`server/db/schema.ts` — compile-time only, so it became JSDoc on a generated type and vanished,
and an agent reading a tool schema on `/mcp` never saw a word of it. And it was a `hint` string
typed out again in the form that renders the column, which no agent sees either. Two copies,
each invisible to the other's reader, and by the time this was noticed they had drifted: the
note under **Retries** in settings and the comment on `maxRetries` were different sentences.

So the prose moved to one place, and the schema carries it:

- `drizzle-graphql`'s `describeColumn` hook puts it on the generated schema, which reaches every
  position the column generates — the row type, the create and update inputs, the filter, the
  aggregates
- from there it is in `schema.graphql`, and in the JSON Schema of every `/mcp` tool that touches
  the column, so an agent filling in `create_task` reads what `prompt` is for
- `@cubicecho/graphql-codegen-field-descriptions` reads the same schema and emits
  `web/__generated__/graphql/descriptions.ts`, a runtime map, which `web/lib/docs.tsx` wraps as
  `describe("Setting", "maxRetries")` — the note under the field in the web app

The web helper is typed against the generated map, so renaming a column and regenerating turns
a stale reference in a form into a typecheck error rather than a note that quietly disappears.
`tests/docs.test.ts` holds the three readings against each other, because each can break on its
own — a hook dropped from `buildSchema`, a plugin dropped from `codegen.ts` — and nothing else
would fail: descriptions would just stop arriving.

Write these for both readers, which is usually the same sentence: what the value does, what an
empty one falls back to, and what it is not. Keep them short. A description is repeated at every
position its column generates, which is what took the `/mcp` listing from ~155 kB to ~167 kB
against the 250 kB the size test allows.

What stays in `server/db/schema.ts` is the other kind of comment: why a column exists at all,
why it is shaped the way it is, what would go wrong without it. That has no room in a field
description and no business in a form.

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
| `npm run codegen` | print `schema.graphql` and regenerate `web/__generated__/` |
| `npm test` | vitest |
| `npm run lint` / `format` | biome |
| `npm run db:generate` | write a migration into `drizzle/` after a schema change |
| `npm run db:migrate` | apply `drizzle/` by hand; the server does it on boot anyway |
| `npm run db:studio` | drizzle studio |
