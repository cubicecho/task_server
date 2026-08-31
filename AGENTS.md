# AGENTS.md — task-server

Scheduled AI tasks. A **task** is a prompt; a **trigger** starts it (cron today, `event` is a
stored row shape with no dispatcher yet); a **run** is one execution, with its status, output,
token counts and error kept. The runner sends the prompt to any OpenAI-compatible model with
every enabled MCP server's tools attached, streaming as it goes. The same API is served three
ways from one process: GraphQL at `/graphql`, MCP tools at `/mcp`, and the built React app on
everything else.

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
npm run db:push          # drizzle-kit, for a column that changed shape
npm run db:studio

# Build / run
npm run build            # typecheck, then vite build into dist/
npm start                # NODE_ENV=production tsx server/index.ts
docker compose up --build
```

## Tech stack

| Choice | Why |
| --- | --- |
| **`node:sqlite` + Drizzle** | No native dependency to build, so the container is a `node:26-slim` with nothing compiled in it. Postgres is the same tables in `pg-core` and a `pg` pool, chosen off `DATABASE_URL` — see below |
| **`@vantreeseba/drizzle-graphql`** | The API is generated from the tables — a new column is queryable as soon as it exists. Hand-written fields fill what CRUD cannot say |
| **graphql-yoga** | Serves the query API and the `runEvents` subscription as SSE, which the browser reads with a plain `EventSource` |
| **`@cubicecho/graphql-mcp`** | Projects the same schema as MCP tools. `server/mcp-endpoint.ts` curates which ones — see below |
| **Node type stripping** | The container runs `node server/index.ts`; `tsx` is a devDependency and is not in the image. Nothing under `server/` may use syntax that survives erasure — no enums, no parameter properties |
| **Biome** | One formatter and linter. `noExplicitAny` and `noNonNullAssertion` are errors here, not warnings |

## Key conventions

**Relative imports carry the `.ts`/`.tsx` extension.** Both tsx and Node's type stripping
require it, and `allowImportingTsExtensions` is on for that reason.

**The schema is the contract, and it is generated.** Add a column to `server/db/schema.sqlite.ts`
*and* `server/db/schema.pg.ts`, run `npm run codegen`, and the typed documents in
`src/graphql/*.graphql` see it. Never hand-write a type that codegen produces, and never edit
`src/gql/graphql.ts` — biome ignores it because it is output.

**Codegen runs on SQLite.** The SDL is the same on both but for one field — postgres adds
`contains` to `JSONFilter` — so `npm run codegen` under a `postgres://` URL produces a
one-field diff to discard, not commit.

**Both dialects, every time.** `server/db/` is the only place that knows whether this is SQLite
or postgres: `dialect.ts` reads `DATABASE_URL`, `schema.ts` picks the tables, `client.ts` the
driver, `migrate.ts` the DDL in `ensure.sqlite.ts` / `ensure.pg.ts`. Above that directory the
postgres tables wear the SQLite tables' types, which holds only while the two schemas agree —
`tests/schema-parity.test.ts` fails when they stop. A schema change is four edits: both schema
files, both DDL files.

**Hand-written GraphQL fields go in `server/graphql/`**, beside the generated entities:
`models`, `mcpStatus`, `schedule`, `runEvents` on the query side; `runTask`, `stopTask`,
`reconnectMcp`, `setApiKey` on the mutation side. Give every one of them a `description` — it
is what an agent on `/mcp` reads to decide whether to call it.

**Writes go through `onWrite` hooks** that rebuild the cron schedule and reconcile the MCP
pool, so a trigger edited in the UI takes effect without a restart. A write that should change
either of those belongs in a hook, not in a route handler.

**`features.nestedWrites` is off** — it needs an asynchronous driver and `node:sqlite` is
synchronous. Postgres could have it, but then the GraphQL schema would depend on the database
and one generated client could not serve both. A task and its triggers save as separate
mutations.

**The `/mcp` surface is curated, not the whole schema.** `server/mcp-endpoint.ts` lists the
fourteen tools an outside client gets. Nothing that empties a table in one call, and nothing
that reads the API key. A new tool goes in that list deliberately, with a `HINTS` entry if the
generated description does not say enough.

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

## CI / release

- `.github/workflows/ci.yml` — biome, typecheck, vitest, build; plus a job that builds the
  Docker image, boots it, and waits for it to answer a GraphQL query
- `.github/workflows/release.yml` — after CI passes on `main`, semantic-release cuts the
  release and one build pushes `latest` and the version to `ghcr.io/<owner>/<repo>` and
  `<user>/task-server` on Docker Hub. Needs the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
  secrets; GHCR uses the built-in `GITHUB_TOKEN`. A `workflow_dispatch` with a version
  publishes the images without cutting a release

## Finding code

Prefer an LSP (definitions, references) over grep when navigating.
