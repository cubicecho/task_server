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

**Hand-written GraphQL fields go in `server/graphql/`**, beside the generated entities:
`models`, `mcpStatus`, `schedule`, `runEvents` on the query side; `runTask`, `stopTask`,
`reconnectMcp`, `setApiKey` on the mutation side. Give every one of them a `description` — it
is what an agent on `/mcp` reads to decide whether to call it.

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

**The tool listing has a size test, and it is not incidental.** The generated relation filters
recurse between tables, and written out as JSON Schema rather than named as SDL they once made
the listing 18 MB — more than a model will read, and it arrives before any call. graphql-mcp
1.0.1 builds each input type once so the repeats become `$ref`s, which brought it to ~456 kB with
the relation filters intact; before that this file pruned them out by hand. It went to ~528 kB on
zod 4 — 2.0.0 made zod a peer dependency, and v4 rendered the same schema less compactly than the
v3 copy the package used to bundle — and back to ~419 kB on 2.2.0, which also named the shared
types after the GraphQL types they came from rather than by position, and is unchanged on 2.3.0.
`tests/mcp-endpoint.test.ts` holds every tool under 100 kB and the listing under 650 kB. The
bounds sit well above the real figure on purpose: it is the driver's to move, and what the test
is for is the order of magnitude. Anything added here that grows it needs to answer to that test
rather than raise the bound.

**A webhook is an id and nothing else.** `POST /webhooks/<id>` always answers 200; it starts
a task only when an enabled `event` trigger on an enabled task carries that exact id, and
reports which ones it started in `dispatched`. There is no signature and no secret — the id is
the whole of the address, so make it unguessable if it matters. The body is parsed and
discarded; the route mounts its own JSON parser rather than `app.use`, because yoga and the
MCP handler read their own bodies.

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
