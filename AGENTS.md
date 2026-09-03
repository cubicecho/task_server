# AGENTS.md — task-server

Scheduled AI tasks. A **task** is a prompt; a **trigger** starts it (`cron` on a schedule,
`event` when `POST /webhooks/<id>` arrives); a **run** is one execution, with its status,
output, token counts and error kept. The runner sends the prompt to any OpenAI-compatible
model with every enabled MCP server's tools attached, streaming as it goes. The same API is
served three ways from one process: GraphQL at `/graphql`, MCP tools at `/mcp`, and the built
React app on everything else, with `POST /webhooks/:id` alongside them.

Read [`README.md`](README.md) first — it holds the design decisions this file only summarises.

Single package, no workspaces: `server/` (Express 5 + graphql-yoga + Drizzle), `src/` (Vite +
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
npm run codegen          # schema, then graphql-codegen into src/gql/graphql.ts
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
| **`@cubicecho/graphql-mcp`** | Projects the same schema as MCP tools. `server/mcp-endpoint.ts` curates which ones — see below |
| **Node type stripping** | The container runs `node server/index.ts`; `tsx` is a devDependency and is not in the image. Nothing under `server/` may use syntax that survives erasure — no enums, no parameter properties |
| **Biome** | One formatter and linter. `noExplicitAny` and `noNonNullAssertion` are errors here, not warnings |

## Key conventions

**Relative imports carry the `.ts`/`.tsx` extension.** Both tsx and Node's type stripping
require it, and `allowImportingTsExtensions` is on for that reason.

**The schema is the contract, and it is generated.** Add a column to `server/db/schema.ts` and
the typed documents in `src/graphql/*.graphql` see it. Never hand-write a type that codegen
produces, and never edit `src/gql/graphql.ts` — biome ignores it because it is output.

`npm run codegen` does it explicitly, but under `npm run dev` you should not need to: the
server rewrites `schema.graphql` on boot and regenerates with it when the SDL moved, and vite
runs codegen off its own watcher for the documents. Both are dev-only — `@graphql-codegen/cli`
is a devDependency and `server/dev/codegen.ts` is behind a `NODE_ENV !== "production"` guard,
because the image has neither codegen nor the sources it would write. `npm run build` runs
codegen before the typecheck, and CI regenerates and diffs it against what is committed.

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
`reconnectMcp`, `setApiKey` on the mutation side. Give every one of them a `description` — it
is what an agent on `/mcp` reads to decide whether to call it.

**A trigger that fires at a task already running leaves a `skipped` run.** `startTask` refuses
it — right for a person or an agent, who are told on the spot — but nothing is watching a cron
tick or a webhook delivery, and a refusal used to leave no trace but a log line. `fireTask` in
`server/runner/run.ts` is the entry point for both dispatchers: it starts the task, or writes a
run of status `skipped` with the reason in `error`. A firing that did nothing has to be as
visible as one that did, or a broken trigger and a busy one look the same. Only the busy case
becomes a row; a missing task or an unwritable database still throws, and the caller logs.

One row per collision, not per firing. A skip records the run that was in the way in
`blockedBy`, and a second firing that meets the same trigger, task and blocking run finds that
row and increments `attempts` rather than adding another — otherwise a sender posting faster
than the task runs buries the history it is meant to be visible in. The row keeps the most
recent payload of the firings it stands for, and `finishedAt` moves with them while `startedAt`
stays at the first, so it spans the collision instead of naming a moment in the middle of it.

**Writes go through `onWrite` hooks** that rebuild the cron schedule and reconcile the MCP
pool, so a trigger edited in the UI takes effect without a restart. A write that should change
either of those belongs in a hook, not in a route handler.

**`features.nestedWrites` is off.** Nothing in the driver stops it; it is simply not earned —
a task and its triggers save as separate mutations, and a flow is written whole by
`setTaskSteps` rather than a row at a time.

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
`inputField` drops those three fields on the way out. It is the same `schema` object yoga serves
the web app from, and the app keeps all of them; a question about a task's triggers is asked
from the trigger end here, where `taskId` is a column.

**The `/mcp-docs` surface is the operations in `server/mcp/tools.graphql`, not the schema.** It
is the other half of a spike: `/mcp` projects root fields, so an agent meets `where: { id: { eq:
… } }` to say which task it means; `/mcp-docs` projects hand-written documents, so
the tool is the operation, its variables are flat and named, and the comment block above it is
the description. Sixteen tools, ~25 kB against ~155 kB, and ~60% of it prose against ~9%.

The documents go through the driver's own `operations` option — never a hand-rolled handler.
That is what makes them validate at boot, naming the file and position, and what makes a tool
answer in the same `{ data, errors }` envelope a generated one does. The temptation is to unwrap
`data` and hand back the row; don't. Argument validation answers *above* any handler, so a tool
with its own success shape shows an agent two shapes for the one tool, and the malformed call is
the one an agent hits most.

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

**The LLM call retries only before the model has spoken.** `server/runner/agent.ts` owns the
retry loop, not the OpenAI SDK, whose own retries are off: once a chunk has arrived the turn
is unrepeatable, so a failure after that propagates. `requestTimeoutSeconds` is a silence
watchdog that rearms on every chunk, not a deadline on the request, and an aborted stream ends
its iteration rather than throwing — hence the `throwIfAborted()` after the loop.

**Run events are debugging output and are not persisted.** They live in an in-memory bus for a
minute after the run ends. Anything worth keeping goes in the run row.

**Frontend:** shadcn primitives in `src/components/ui/` with no app logic; routes in
`src/routes/`; `@/` maps to `src/`. Every query goes through `request()` in `src/lib/gql.ts`
with a typed document — no raw `fetch` in a component — and every mutation invalidates the
query keys it affected.

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

## Finding code

Prefer an LSP (definitions, references) over grep when navigating.
