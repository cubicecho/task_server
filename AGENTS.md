# AGENTS.md — task-server

Scheduled AI tasks. A **task** is a prompt; a **trigger** starts it (`cron` on a schedule,
`event` when `POST /webhooks/<id>` arrives); a **run** is one execution, with its status,
output, token counts and error kept. The runner sends the prompt to any OpenAI-compatible
model with every enabled MCP server's tools attached, streaming as it goes. The same API is
served three ways from one process: GraphQL at `/graphql`, MCP tools at `/mcp`, and the built
React app on everything else, with `POST /webhooks/:id` alongside them.

Read [`README.md`](README.md) first — it holds the design decisions this file only summarises.
When the question is what to build or adopt *next* rather than how this works today, read
[`future-libs-architecture.md`](future-libs-architecture.md) — see [Future work](#future-work).

Single package, no workspaces: `server/` (Express 5 + graphql-yoga + Drizzle), `web/` (Vite +
React 19 + TanStack Router/Query + shadcn), `tests/` (Vitest).

## Commands

```bash
# Dev
npm run dev              # express on :8787 + vite on :3000, concurrently
npm run dev:server       # tsx watch server/index.ts
npm run dev:web          # vite only (proxies /graphql to :8787)

# Quality — run all three before every commit; CI fails otherwise
npm run lint             # biome check (use `npx biome ci .` for the read-only form)
npm run format           # biome check --write
npm run typecheck        # tsc --noEmit
npm test                 # vitest run

# Schema and types
npm run schema           # prints the runtime schema to schema.graphql
npm run codegen          # schema, then graphql-codegen into web/__generated__/graphql/graphql.ts
npm run db:generate      # drizzle-kit, after a change to server/db/schema.ts
npm run db:migrate       # apply drizzle/ by hand; the server does this on boot anyway
npm run db:studio

# Build / run
npm run build            # typecheck, then vite build into dist/
npm start                # NODE_ENV=production tsx server/index.ts
docker compose up --build
```

## Tech stack

| Choice | Why |
| --- | --- |
| **Postgres + Drizzle** | One dialect everywhere. With no `DATABASE_URL` the server runs PGlite — postgres as WebAssembly, in-process, against `data/` — so a clone and the tests need no database of their own; set the variable and it is a `pg` pool instead. Same SQL, same types, either way |
| **`@vantreeseba/drizzle-graphql`** | The API is generated from the tables — a new column is queryable as soon as it exists. Hand-written fields fill what CRUD cannot say |
| **graphql-yoga** | Serves the query API and the `runEvents` subscription as SSE, which the browser reads with a plain `EventSource` |
| **`@vantreeseba/graphql-casl`** | Who may call what, as CASL rules over the schema rather than over an endpoint. `applyPermissions` wraps the schema `server/graphql/schema.ts` exports, so `/graphql` and `/mcp` are held to one map — see below |
| **`@cubicecho/graphql-codegen-field-descriptions`** | The SDL descriptions authored in `server/graphql/docs.ts` reach the browser as data, not as JSDoc that erases. One string is the note under a form field and the tool-schema description an agent reads |
| **`@cubicecho/graphql-mcp`** | Projects the same schema as MCP tools. `server/mcp-endpoint.ts` curates which ones — see below |
| **Node type stripping** | The container runs `node server/index.ts`; `tsx` is a devDependency and is not in the image. Nothing under `server/` may use syntax that survives erasure — no enums, no parameter properties |
| **Biome** | One formatter and linter. `noExplicitAny` and `noNonNullAssertion` are errors here, not warnings |

## Key conventions

**Relative imports carry the `.ts`/`.tsx` extension.** Both tsx and Node's type stripping
require it, and `allowImportingTsExtensions` is on for that reason.

**The schema is the contract, and it is generated.** Add a column to `server/db/schema.ts` and
the typed documents in `web/graphql/*.graphql` see it. Never hand-write a type that codegen
produces, and never edit `web/__generated__/graphql/graphql.ts` — it's gitignored, not committed,
because it is output: `typecheck`, `build` and the dev server all regenerate it themselves, so a
checked-in copy could only go stale silently instead of being caught.

`npm run codegen` does it explicitly, but you rarely need to: `typecheck` and `test` each
regenerate it first via a `pre*` script, `build` runs `typecheck`, and under `npm run dev` the
server rewrites `schema.graphql` on boot and regenerates with it when the SDL moved, while vite
runs codegen off its own watcher for the documents. The dev-server and vite paths are dev-only —
`@graphql-codegen/cli` is a devDependency and `server/dev/codegen.ts` is behind a
`NODE_ENV !== "production"` guard, because the image has neither codegen nor the sources it
would write; production serves a `dist/` built against the types it was typechecked with, and
`npm start` never calls it. `schema.graphql` is the one artefact still committed — CI
regenerates and diffs it against what is committed, so a table changed without a `npm run
schema` is caught as drift.

**A schema change is an edit and a generate.** Change `server/db/schema.ts`, then run
`npm run db:generate` and commit what lands in `drizzle/` — the SQL and the snapshot both.
`server/db/migrate.ts` applies that folder on boot, against PGlite or a `pg` pool alike, so
nothing hand-writes DDL any more. Never edit a migration that has shipped; generate another.

**Only `client.ts` knows which postgres this is.** It reads `DATABASE_URL` and opens either a
`pg` pool or a PGlite instance, and hands out one `db` under one set of types. Nothing above
`server/db/` should branch on it.

It also claims the data directory, because PGlite does not: two processes on one directory both
open it and then stop seeing each other's writes. A pid in `<store>.lock` refuses the second
one, takes over a lock whose holder is gone, and does nothing at all for a `postgres://` URL or
`memory://`. It cannot see across a pid namespace, so a container sharing the bind-mounted
`./data` with a host process is still on its own — that case is what `DATABASE_URL` is for.

**Hand-written GraphQL fields go in `server/graphql/`**, beside the generated entities:
`models`, `mcpStatus`, `schedule`, `runEvents` on the query side; `runTask`, `stopTask`,
`reconnectMcp`, `setApiKey`, `setAgentApiKey` on the mutation side. Give every one of them a
`description` — it is what an agent on `/mcp` reads to decide whether to call it.

**A trigger that fires at a task that cannot start leaves a row either way.** `startTask` refuses
it — right for a person or an agent, who are told on the spot — but nothing is watching a cron
tick or a webhook delivery, and a refusal used to leave no trace but a log line. `fireTask` in
`server/runner/run.ts` is the entry point for both dispatchers: it starts the task, writes a run
of status `skipped` with the reason in `error`, or writes a `queued` one that runs when a slot
comes back — see the two paragraphs below for which. A firing that did nothing has to be as
visible as one that did, or a broken trigger and a busy one look the same. Only a refusal becomes
a row; a missing task or an unwritable database still throws, and the caller logs.

One row per collision, not per firing. A skip records the run that was in the way in
`blockedBy`, and a second firing that meets the same trigger, task and blocking run finds that
row and increments `attempts` rather than adding another — otherwise a sender posting faster
than the task runs buries the history it is meant to be visible in. The row keeps the most
recent payload of the firings it stands for, and `finishedAt` moves with them while `startedAt`
stays at the first, so it spans the collision instead of naming a moment in the middle of it.

There are two refusals and they come to different rows. `TaskBusyError` is the task's own run in
the way and stays a skip: the work is in flight, and queueing a second copy behind it runs a
five-minute task twelve times over an hour it was never meant to. `AtCapacityError` is
`settings.maxConcurrentRuns` runs already in flight across every task (four by default, zero for
no ceiling), and that firing waits — `enqueue` writes a `queued` run, and the difference between
a task that ran late and a task that did not run is the whole of why. Both extend
`RunRefusedError`, which is what `fireTask` catches, so a new reason to turn a firing away is a
subclass and a branch there rather than an edit to either dispatcher. `startTask` itself is
unchanged and still throws for both, because a person or an agent asking for a run now is owed
an answer now, not a row that starts while they are not looking.

**The queue is the run table.** A `queued` row *is* the run, before it has run: `startQueued`
updates it in place to `running`, so the id a webhook was told when the delivery arrived is the
id that ends up holding the output. It survives a restart for free (`server/index.ts` drains
once on boot), and the wait is visible on the Runs page rather than only in this process's
memory. `startedAt` is reset when it starts, or the duration would include the waiting.

One row per waiting trigger, for the reason skips collapse: `enqueue` finds an existing `queued`
row for the same task and trigger, bumps `attempts` and takes the newest payload. A sender
posting every second at a full server would otherwise write a queue that takes an hour to drain,
of three hundred copies of one delivery.

Draining is chained, never concurrent — `drainQueue` appends to a promise, and two runs finishing
in the same tick would otherwise both pick the same waiting row. It runs from `execute`'s
`finally`, from boot, and from the settings `onWrite` hook, that last one through `drainSoon`'s
50 ms debounce because a hook runs inside the mutation's transaction and would read the limit as
it stood before the write that raised it. `drainOnce` steps over tasks already in flight rather
than waiting for them, takes the oldest waiting row, and stops the moment one cannot start. A
task disabled while its firing waited finishes the row as `skipped` instead: "stop firing this"
honoured minutes late is not honouring it.

`startTask` claims the slot before it writes anything, with no `await` between the check and the
`inFlight.set`, and deletes the entry if the inserts then throw. Node is single-threaded but not
uninterruptible: `loadSettings` and the run insert both yield, and two firings that arrive in
the same tick would otherwise both read `size < limit` and both start.
`tests/concurrency.test.ts` races two `Promise.all`'d firings for the last slot — one starts and
one queues — and it fails if the claim moves back down. `runningRunIds()` filters empty ids out for the same reason — a
claimed entry has no run id for the width of the insert.

**Writes go through `onWrite` hooks** that rebuild the cron schedule and reconcile the MCP
pool, so a trigger edited in the UI takes effect without a restart. A write that should change
either of those belongs in a hook, not in a route handler.

**`features.nestedWrites` is off.** Nothing in the driver stops it; it is simply not earned —
a task and its triggers save as separate mutations, and a flow is written whole by
`setTaskSteps` rather than a row at a time.

**Permissions go on the schema, never on an endpoint.** `server/graphql/permissions.ts` is the
one place that says who may call what, and `applyPermissions` puts it on the schema that both
doors serve. `TOOLS` in `mcp-endpoint.ts` is a listing — what an agent's context is spent on —
and never a lock: both endpoints are one schema in one process, so a rule bolted onto `/mcp`
says nothing about the same field reached over `/graphql`.

The identity is the door. There are no accounts and no token: `/graphql` sets `caller:
"operator"`, `/mcp` sets `caller: "agent"` through `contextFromRequest`, and a request with no
context at all — a test calling `graphql()`, the server executing its own schema — is the
operator. An agent writes and runs tasks; it may not read or write the settings row (the
operator's endpoint, model and key), the agent profiles (the same three per task, plus the
server scope), the MCP server rows (`env` and `headers` are credentials, and `testMcpServer`
spawns a stdio command), or delete run history. `/graphql` has no
authentication, so today the split is defence in depth over `/mcp`; a shared token is what would
make a `Bearer` on `/graphql` an agent too.

Mutations are a whitelist — `"*": deny` heads the map — so a write a new table generates ships
shut. Every bulk form is shut for *everyone*, the operator included: `deleteTask` with no
`where` empties the table where `deleteTaskSingle` cannot, and every document under
`web/graphql/` uses a single-row form already. Reads are the other way round, `"*": accept` with
the three guarded tables named, each in all four generated spellings (`x`, `xs`, `xsAggregate`,
`xsGroupBy`) — guarding the plural alone guards the front door of a room with two. A rule on the
type goes with them, since `Task.agent` is a relation an agent may walk to from a task it may
read, and a rule on `Query.agents` is not there to meet it.

`tests/permissions.test.ts` asks the schema as each caller, and runs every rule named in `TOOLS`
as an agent: a field added to the listing that the map denies is a tool that is advertised,
called, and refuses every time, which an agent cannot tell from a broken server.

**The `/mcp` surface is curated, not the whole schema.** `server/mcp-endpoint.ts` lists the
seventeen tools an outside client gets. Nothing that empties a table in one call, and nothing
that reads the API key. A new tool goes in that list deliberately, with a `HINTS` entry if the
generated description does not say enough. The driver renames after it filters, so the `include`
list names GraphQL fields in camelCase while `HINTS` — and the client — sees the snake_case tool
name: `Mutation.createTask` is the tool `create_task`.

`toolNameFor` is that spelling, and it also drops the `Single` off the single-row writes:
`Mutation.updateTaskSingle` is the tool `update_task`. drizzle-graphql needs the qualifier
because it generates a bulk `updateTask` beside it; this surface excludes the bulk form
entirely, so the qualifier only distinguished a tool from one that is not here, and agents read
it as a variant to choose between rather than as the update. It cannot be renamed upstream —
`suffixes.single` reaches the single *insert* and is ignored by update and delete — and it
should not be, since the web app has both forms and needs to tell them apart. `TOOL_NAMES` runs
through the same function, so a name written in prose and the tool it names cannot drift.

Descriptions are written once and read twice, so a cross-reference between fields is respelled
on the way out: `useToolNames` rewrites a backticked root-field name to its tool name in the
prose, leaving the driver's generated footer — which is a claim about the GraphQL schema — as it
found it. Write `runEvents` in a description under `server/graphql/` and an agent reads
`run_events`. Only names that are tools here are touched, so result columns keep their spelling.

**The tool listing has a size test, and it is not incidental.** The generated relation filters
recurse between tables, and written out as JSON Schema rather than named as SDL they once made
the listing 18 MB — more than a model will read, and it arrives before any call. graphql-mcp
1.0.1 builds each input type once so the repeats become `$ref`s, which brought it to ~456 kB with
the relation filters intact; before that this file pruned them out by hand. It went to ~528 kB on
zod 4 — 2.0.0 made zod a peer dependency, and v4 rendered the same schema less compactly than the
v3 copy the package used to bundle — and back to ~419 kB on 2.2.0, which also named the shared
types after the GraphQL types they came from rather than by position, and was unchanged on 2.3.0.
It went to ~379 kB on 2.7.0, where the reads gave up their explicit `null` branches — see below.
Two changes upstream then took it to **~155 kB**: drizzle-graphql 12 gave each column type only
the operators it can use, which is ~94 kB of `startsWith` on a boolean and `ilike` on a
timestamp, and graphql-mcp 2.9.0's `inputField` took the relation filters out of the projection,
which is ~130 kB more — see below. `tests/mcp-endpoint.test.ts` holds every tool under 40 kB and
the listing under 250 kB. The bounds sit above the real figure on purpose: it is the driver's to
move, and what the test is for is the order of magnitude. Anything added here that grows it needs
to answer to that test rather than raise the bound.

**Reads drop their null branches; writes keep theirs.** A nullable argument is advertised twice
over — absent from `required`, *and* carrying an explicit `null` branch — and on a surface that
is mostly generated filter types the second is about a fifth of the bytes. Dropping it everywhere
was tried and reverted: on a mutation input the branch is how a caller clears a column, and also
how a model says "this optional is absent", so `"cases": null` beside the fields it did fill in
became a validation error. On a `where` or an `orderBy` there is nothing an explicit null means.
2.6.0 made `nullBranches` a per-field decision, so `mcp-endpoint.ts` splits it by kind and gets
both answers. If you ever flatten the tools' `$defs` into one namespace downstream, note that
the same input type now renders two ways across the surface.

2.10.0 added `{ byType }` for the rule this actually wants — a filter never takes an explicit
null, wherever it appears — and it does not reach it. The mode resolves at each *position's* own
named type, and a filter's bytes are in its leaves: `StringFilter.eq` is a `String`, and so is
`CreateTaskInput.model`. Keyed that way the write payloads lose their branches along with the
filters, which is the reverted regression above, so the per-kind split is what is expressible
and `byType` stays unused here. Measured on a three-tool probe: `never` everywhere is −22.6%,
the per-kind split gets −11.3%, and the `byType` example from the driver's own docs gets −5.4%.

**Relation filters are pruned from the projection, not from the schema.** `TaskFilters` takes
`triggers`/`steps`/`runs` as list-relation filters, each pulling in the neighbouring table's
whole filter type, which carries its own relation fields back — the closure that was most of
this listing's weight, for a question no agent asked across 100 logged calls. 2.9.0's
`inputField` drops those three fields on the way out, and `agent` with them: a one-relation
costs a whole `AgentFilters` for a table this surface does not offer at all. The scalar
`agentId` stays, since a column costs one `StringFilter`. It is the same `schema` object yoga serves
the web app from, and the app keeps all of them; a question about a task's triggers is asked
from the trigger end here, where `taskId` is a column.

**Hand-written operation tools were tried here and are not coming back.** A spike mounted a
second endpoint, `/mcp-docs`, whose tools were documents rather than projected root fields —
sixteen tools in ~25 kB against seventeen in ~155 kB. Five errands across both surfaces came out
5/5 either way with no failed calls, so the smaller listing bought no accuracy, and it cost a
file per question that has to be kept in step with the schema. What the runs were worth is in
the two size sections above, which act on the finding behind them: across a hundred logged calls
the only filter operator any agent sent was `eq`. Adding a document surface again needs a reason
the measurement did not already answer.

**A column is described once, in `server/graphql/docs.ts`.** That file is the only copy of what
a generated field means. `describeColumn` puts it on the schema, so it lands in `schema.graphql`,
in the JSON Schema of every `/mcp` tool that touches the column, and — through the codegen plugin,
as `web/__generated__/graphql/descriptions.ts` — under the field in the web app, where
`web/lib/docs.tsx` reads it as `describe("Setting", "maxRetries")` — or, since a form is usually
one table, `describeFor("Setting")`. It renders as a node rather than a string because these
sentences are written for two readers at once: `ticks()` turns the backticks a model reads as
markdown into `<code>` for everyone else.

It was written twice before and reached nobody twice: JSDoc on the column, which is compile-time
only and so never reached an agent, and a `hint` literal in the form, which never reached one
either. The two had already drifted. Never reintroduce the second copy — a form that needs a
note names the column instead, and the helper is typed against the generated map, so a renamed
column is a typecheck error rather than a note that silently disappears.

Write for both readers at once: what the value does, what an empty one falls back to, what it is
not. Keep it short — a description repeats at every position its column generates (row type,
create and update inputs, filter, aggregates), and the `/mcp` listing has a size test. The
comment that explains *why* a column exists stays in `server/db/schema.ts`, where it has room.
`tests/docs.test.ts` holds the schema, the generated map and the authored copy against each
other, since any one of the three can break silently.

**A webhook is an id and nothing else.** `POST /webhooks/<id>` always answers 200; it starts
a task only when an enabled `event` trigger on an enabled task carries that exact id, and
reports the ones that actually started in `dispatched` and the ones that would not in
`refused`, with the reason and a `runId` for both. `startTask` is what makes that answerable:
it settles once the run row exists, so the reply says what started without waiting for it. There
is no signature and no secret — the id is the whole of the address, so make it unguessable if it
matters.

The route mounts its own JSON parser rather than `app.use`, because yoga and the MCP handler
read their own bodies, and it swallows that parser's failures instead of passing them to
Express: malformed JSON or a body over the 1 MB limit would otherwise be a 500 here and a 400
in a bare router, telling a sender its delivery failed when the id arrived perfectly well. A
body is an argument to the event and never a condition of it, so an unreadable one is logged
and the request goes on with no payload.

**The payload is threaded, stored and templated.** A parsed body goes `webhooks.ts` →
`fireTask` → `startTask` → `runFlow` → `renderPrompt`, is written to `runs.payload` on the way
past, and appears in a prompt as `{{event}}`. It is stored because the prompt the agent saw
depended on it, and a run that kept its output but not its input could not be read back. It is
kept on `skipped` rows too. `{{event}}` deliberately does *not* set `renderPrompt`'s `placed`
flag — that flag means the prompt has said where the earlier *step* context goes, and the
webhook body says nothing about that — so a prompt can place the payload and still get its
preamble. The server never looks inside a payload; whole-body `{{event}}` is the whole of the
feature, and there is no `{{event.field}}` path access.

A webhook is not the only entrance. `runTask(taskId:, payload:)` takes the same body from a
person or an agent — `RunDialog` in the web app, the `run_task` tool over `/mcp` — and passes
it to `startTask` with **no** `triggerId`. That is deliberate: a replay of a failed delivery is
a hand-started run, and one that named the trigger it was copied from would write a delivery
into the history that nobody sent. Everything downstream is unchanged, which is the point —
there is one path a payload travels, and the argument only decides where it entered.

**An agent profile is a settings row, not a second config.** A task may name one
(`tasks.agentId`, null for the settings row, which is every task until somebody makes a profile),
and `server/runner/profile.ts` lays the profile over the settings row and hands the run the
result. Nothing downstream branches: `agent.ts`, `flow.ts` and `llm.ts` read one `Settings`
exactly as they always did, which is why per-task endpoints cost the agent loop nothing. Blank
is inherit, and the sentinel differs by column because zero is a real answer for most of them —
`""` for text, `-1` for a number, the word `inherit` for `toolDiscovery`.

The key is the one column that is not a plain override. A profile naming a `baseUrl` of its own
never inherits `settings.apiKey` or `$OPENAI_API_KEY` — it uses its own key or `NO_KEY`, the
constant `llm.ts` exports for "there is no key here, do not fall through to the environment".
A credential issued for one endpoint has no business being posted to another. A profile on the
*same* endpoint inherits it like anything else. `llm.ts` caches a client per endpoint for the
same reason: two profiles on two servers would otherwise evict each other's connection pool on
every request.

`mcpServerIds` is a jsonb array rather than a join table — there is nothing to say about the
pairing, it is written whole with its row, and a table would generate CRUD, permissions and
tools for it. Empty or absent is every enabled server. The scope is enforced in `mcp.call` as
well as in `tools()` and `catalog()`, and an out-of-scope tool is refused with the same words as
one that does not exist: a model that remembers a name from a wider run must not be taught to ask
again. Which *tools* of a server a task may use is deliberately not here — that belongs to a
router endpoint in front of them, where every app in the ecosystem gets the same answer, and
scope written twice is scope that disagrees.

Profiles are the operator's on both sides: they carry an endpoint, a key and the tool scope,
which is the settings row's own argument. `agentId` on a task stays readable, so an agent on
`/mcp` can see that a task runs on a profile without being able to read or choose one.

**The LLM call retries only before the model has spoken.** `server/runner/agent.ts` owns the
retry loop, not the OpenAI SDK, whose own retries are off: once a chunk has arrived the turn
is unrepeatable, so a failure after that propagates. `requestTimeoutSeconds` is a silence
watchdog that rearms on every chunk, not a deadline on the request, and an aborted stream ends
its iteration rather than throwing — hence the `throwIfAborted()` after the loop.

**Run events are debugging output and are not persisted.** They live in an in-memory bus for a
minute after the run ends. Anything worth keeping goes in the run row.

**Frontend:** shadcn primitives in `web/components/ui/` with no app logic; routes in
`web/routes/`; `@/` maps to `web/`. Every query goes through `request()` in `web/lib/gql.ts`
with a typed document — no raw `fetch` in a component — and every mutation invalidates the
query keys it affected.

**The shapes come from `@cubeui`, and they take parts rather than children.** `components.json`
registers `https://cubicecho.github.io/cubeui/r/{name}.json`, and `npx shadcn add @cubeui/<name>`
copies a shell into `web/components/` rewritten against the local aliases — there is no runtime
dependency, and an installed file is this repo's to edit. What is here: `PageLayout` (every
route's header, trail, action row and body), `DialogLayout` (title, body, `footer` for a side
control and `footerActions` for cancel/confirm, and the unsaved-changes guard), `Section`,
`CardLayout`, `SplitLayout`, `QueryState` with `QueryError`, `DisclosureRow`, `ActionButton`,
`ConfirmButton`, `FormField`, `FieldRow`, `MultiSelect`, `PasswordInput`, `ModelSelect`'s field
wrapper. **No cubeui component takes `children`** — the body is the `content` prop, and every
other slot is a prop too, which is what stops a shell from being subclassed by nesting. Never
hand-write `mx-auto max-w-3xl` or a `<header className="border-b px-6 py-4">`: that is
`PageLayout` being re-derived, and the point of taking the registry was to stop having four of
them.

`ActionButton` and `ConfirmButton` take a required `label`, which is the accessible name — an
icon-only button with no `label` does not typecheck. Neither sets `type`, so inside a `<form>`
every one of them needs `type="button"` or it submits the form.

**Forms are `@tanstack/react-form`, through `web/components/app-form.tsx`.** `useAppForm` binds
the shadcn controls to `FormField`, so a field is one line — `<field.InputField label="Name"
required />` — with its own `validators`, and the error lands under the input as it is typed
rather than as a toast on the way out. The hook's `fieldComponents` are `InputField`,
`NumberField`, `TextareaField`, `SelectField`, `CheckboxField` and `SwitchField`; the richer
ones (`ModelSelectField`, `MultiSelectField`, `PasswordField`, `RadioGroupField`) are standalone
and take the form — `<PasswordField form={form} name="apiKey" …/>`. A dialog passes
`form.state.isDirty` to `DialogLayout`'s `hasUnsavedChanges`; the guard is asked for, never
computed.

One thing the driver cannot do: it types a field's `name` by walking the whole store's shape,
with no depth limit, so a value that contains itself is `TS2589` — reported at the *first* field
in the form, not at the recursive one. `task-edit.tsx` holds the flow as `unknown` for that
reason (a step has branches, and a branch has steps) and casts at the one place it is read.

**A `where` a person assembles goes in `web/lib/`, not in the route.** `run-filters.ts` builds
the runs page's filter, and `tests/run-history.test.ts` runs what it builds — with the printed
`RunsDocument`, so the test cannot drift from the query the browser sends — against a real
database. The shape typechecks either way; whether an escaped `%`, an enum `eq` and an `OR`
across a relation mean what the controls above the list say they mean is a question about SQL,
and the `@` alias is in `vitest.config.ts` so a server test can ask it. A filter built inside a
`.tsx` is a filter nothing can test.

The same goes for a rule a page draws conclusions from. `task-health.ts` decides which of seven
heaps a task is in for the status page, and `tests/status.test.ts` seeds a task per answer and
asks that function what the browser asks it. Whether a skipped row older than the last run means
the task is still falling behind is a question with a right answer, and it is not one a
screenshot settles.

## Code style

- Biome-enforced: double quotes, semicolons, trailing commas, 2-space indent, 100 line width,
  `import type` for type-only imports, imports organised on save
- Files `kebab-case.ts(x)`; components `PascalCase`; vars and functions `camelCase`; true
  constants `SCREAMING_SNAKE_CASE`
- Prefix an unused parameter with `_`; `unknown` over `any`, which is an error
- Comments explain why, not what. A comment that restates the line below it is noise
- Tests are `tests/*.test.ts`, Vitest `describe`/`it`/`expect`, against a temp
  `TASK_SERVER_DATA_DIR` — no mocks of the database, and MCP tests drive a real stdio fixture

## Git

- Use **Conventional Commits**, always: `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`,
  `test:`, `build:`, `ci:`, `chore:`, with an optional scope (`feat(web): …`) and breaking
  changes via `!` or a `BREAKING CHANGE:` footer. semantic-release derives the version and the
  Docker image tags from these on `main`, so a `feat:` or `fix:` is what makes a release happen
  and anything else ships nothing
- Subject in the imperative, lowercase after the colon, no trailing period. The body says why,
  wrapped at 80
- Run `npm run lint`, `npm run typecheck` and `npm test` before every commit
- Branch for the work; `main` is what CI and release watch
- **Never rebase — merge.** To bring `main` into a branch, `git merge origin/main`. Rebasing
  rewrites commits other checkouts and worktrees may already have, and this repo is worked on
  from several at once; a merge commit records what actually happened instead

## CI / release

- `.github/workflows/ci.yml` — biome, typecheck, vitest, build; plus a job that builds the
  Docker image, boots it, and waits for it to answer a GraphQL query
- `.github/workflows/release.yml` — after CI passes on `main`, semantic-release cuts the
  release and one build pushes `latest` and the version to `ghcr.io/<owner>/<repo>` and
  `<user>/task-server` on Docker Hub. GHCR uses the built-in `GITHUB_TOKEN` and needs no
  setup. Docker Hub is optional: `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` come from the
  organisation's shared secrets, and when they are absent those tags and the login are
  skipped rather than failing the release. Note that an organisation secret on the free
  plan reaches public repositories only. A `workflow_dispatch` with a version publishes
  the images without cutting a release

## Future work

Before proposing a library, a search feature, an audit log, or client-side form validation,
read [`future-libs-architecture.md`](future-libs-architecture.md). It is the standing answer to
"would this help here?" for the libraries next door — what each would buy this server, what
blocks it, and what would have to be true first. Five were looked at and ruled out with
reasons, so a proposal that reopens one of those needs to answer the reason rather than restate
the idea. Findings age: correct the file when one stops being true.

## Finding code

Prefer an LSP (definitions, references) over grep when navigating.
