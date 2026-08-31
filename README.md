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
- **mcp server** — a stdio or http MCP server whose tools every run can reach, exposed to the
  model as `slug__tool-name`.
- **settings** — a single row: base URL, key, default model and system prompt, token and
  temperature limits, and the cap on tool iterations per run.

Disabling a task disables its triggers with it — the switch on the task is what a user reaches
for to make it stop.

## Layout

```
server/
  db/          drizzle schema, client, and the boot-time CREATE TABLE IF NOT EXISTS
  graphql/     the schema: drizzle-graphql entities plus a few hand-written fields
  runner/      llm client, MCP pool, the agent loop, and the run recorder
  scheduler/   node-cron, rebuilt from the triggers table on every relevant write
  index.ts     express + yoga + the MCP endpoint + the built SPA
src/           vite + react + tanstack router/query + shadcn
tests/         vitest
```

## GraphQL

The API is generated from the Drizzle tables by
[`@vantreeseba/drizzle-graphql`](https://github.com/vantreeseba/drizzle-graphql), so a new
column is queryable as soon as it exists. Hand-written fields fill the gaps that CRUD cannot
express: `models`, `mcpStatus` and `schedule` on the query side, `runTask`, `reconnectMcp` and
`setApiKey` on the mutation side.

- **`POST /graphql`** — the API, plus GraphiQL in a browser.
- **`POST /mcp`** — the same schema served as MCP tools by `@cubicecho/graphql-mcp`, so an
  agent elsewhere can create and run tasks here.

Writes go through `onWrite` hooks that rebuild the cron schedule and reconcile the MCP pool, so
editing a trigger in the UI takes effect immediately.

`features.nestedWrites` is off: it needs an asynchronous SQLite driver, and this app uses Node's
synchronous built-in `node:sqlite` to stay free of native dependencies. The UI therefore saves a
task and its triggers as separate mutations.

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
