# Future libraries

Libraries from the same workshop as the ones this server already runs on, weighed against what
this server actually needs. Written down because the answer to "would this help here?" is worth
keeping once it has been worked out, and because two of the answers are *no* for reasons that
would otherwise be rediscovered.

Nothing here is a plan. It is what was found when each was looked at, and what would have to be
true before it went in. Read it when picking up future work, and correct it when a finding stops
being true — a `no` here is a measurement, not a policy.

Already in: `@vantreeseba/drizzle-graphql`, `@vantreeseba/graphql-casl`,
`@cubicecho/graphql-mcp`, `@cubicecho/graphql-codegen-field-descriptions`. Those are argued in
[`README.md`](README.md) and [`AGENTS.md`](AGENTS.md); this file is only the ones that are not.

## `@vantreeseba/graphql-zod` — wanted, blocked upstream

**What it is.** A codegen plugin that emits a Zod schema per named operation —
`{Name}{Type}VariablesSchema` and `{Name}{Type}ResultSchema` — from the typed documents under
`web/graphql/`, plus a small runtime package the generated code imports.

**Why here.** The forms in this app validate nothing on the client. A required column comes back
as a server error after a round trip, or — worse for `settings.tsx`, which writes a row of
numbers — as a silently accepted `NaN`. The schemas are generated from the documents, so they
say what the mutation actually requires rather than what someone remembered it requires, which
is the same argument as [Field descriptions](README.md#field-descriptions): one source, no drift.

It does that well. Run against `CreateTask` on this schema it produces exactly what a form
wants — the non-null columns get `.min(1)` with a message, the nullable ones `.nullish()`:

```ts
export const CreateTaskMutationVariablesSchema = z.object({
  values: z.object({
    name: z.string().min(1, { message: 'Name is required' }),
    prompt: z.string().min(1, { message: 'Prompt is required' }),
    model: z.string().nullish(),
    enabled: z.boolean().nullish(),
    // ...
  }),
});
```

**What blocks it.** Three things, found by running the built plugin against this repo's real
schema and documents:

1. **Neither package is published.** `@vantreeseba/graphql-zod` and
   `@vantreeseba/graphql-zod-codegen` are 404 on npm, and the repo has no release workflow —
   so this is a decision about that repo before it is a change to this one. A `file:` dependency
   is not a way round it: the Docker build runs `npm ci` and would not resolve one.
2. **It stack-overflows on `SetTaskSteps`.** `StepInput` and `StepBranchInput` are mutually
   recursive, because a flow is written whole and nested — a decision's branches hold steps
   which hold branches. The plugin walks input types without a seen-set, so it recurses until
   the stack goes: `Generate [FAILED: Maximum call stack size exceeded]`. The other three
   document files generate fine; `tasks.graphql` is the one that fails, and it fails the whole
   run. The generated relation filters (`TaskFilters` → `TriggerFilters` → `TaskFilters`) are
   the same cycle, and would hit it too if a document ever took a filter as a variable. The fix
   is `z.lazy()` behind a set of types already being emitted.
3. **Enums become `z.any()`.** Deferred in the library's own TODO, and it lands exactly where
   it hurts: `McpServersTransportEnum` and `SettingsToolDiscoveryEnum` are the enum fields in
   the two forms most worth validating.

Custom scalars are not a blocker. Left alone `DateTime`, `JSON`, `UUID` and `BigInt` warn and
fall back to `z.any()`, and a `scalars` map fixes all four — a second map beside the one
`codegen.ts` already keeps, holding zod expressions (`DateTime: "z.string()"`) rather than the
TypeScript names the other plugins take.

**Before it goes in:** the cycle guard and enum support land upstream, both packages publish,
and then the plugin is a second entry in `codegen.ts` beside the descriptions one — with the
forms reading the generated schemas rather than growing hand-written ones, which would be the
drift this was meant to avoid.

## `@vantreeseba/graphql-audit-middleware` — the best fit, unpublished

**What it is.** A `graphql-middleware` plugin that records every mutation as a changeset: who,
when, and the forward and undo diff of each row it wrote. Attribution comes from the GraphQL
layer, capture from a source you pick — a Drizzle wrapper, an explicit `recordChange`, or the
resolver's return value diffed against a `getPreviousState`.

**Why here.** `server/graphql/permissions.ts` decides who *may* write. Nothing records who
*did*. That gap is already argued in this repo, in the rule that an agent may not delete a run:
"an agent tidying away the run that recorded what it did is the one edit nobody can audit
afterwards". The same argument reaches further than the rule does — an agent may rewrite a
task's prompt or repoint a trigger with no trace at all, and those are writes it is *supposed*
to be able to make. An audit log is what makes them reviewable instead of merely permitted.

The wiring is already here: `graphql-middleware` is a dependency (a `graphql-casl` peer), the
writes go through Drizzle, and `caller` is in the context for the middleware to read as the
actor. The changeset is per mutation across every table it touched, which is what
`setTaskSteps` needs — it rewrites a whole flow, and a per-row log of that is unreadable.

**What blocks it.** `0.0.0-development` and unpublished. Nothing else.

**Before it goes in:** decide where a changeset is *stored* — a table here means a migration and
a retention story of its own, and run rows already have one (`runRetentionDays`). The obvious
shape is an `audits` table with the same hourly prune, and the operator-only read rule that
`Setting` and `McpServer` already have.

## `@vantreeseba/graphql-indexing` — real need, premature

**What it is.** Middleware that keeps a search index in step with mutations, with a Postgres
engine (tsvector, pgvector) or an Elasticsearch one.

**Why here.** `runs.tsx` has no search. A run row holds the whole output and error text, and a
task on a five-minute cron writes over a hundred thousand rows a year — the retention setting
exists because of exactly that. Finding the run where something was said is a real question with
no answer in the UI today.

**What blocks it.** `0.0.1`, unpublished, and the harder half is local: this server runs on
PGlite by default, and whether tsvector and pgvector are available there — and how a migration
that creates an index behaves under both PGlite and a `pg` pool — has not been checked. A search
that only works when `DATABASE_URL` is set is a different feature from the one worth having.

**Before it goes in:** answer the PGlite question first, then decide whether the need is full
text or just `ilike` over `output` with a date range, which needs no library at all.

## `@cubicecho/cubeui` — right idea, nothing to collect yet

**What it is.** A shadcn registry of the layout shells the cubicecho apps kept re-deriving —
`CardLayout`, `DialogLayout`, `PageHeader`, `PageLayout`, `SplitPane`. Components are copied in
through the shadcn CLI and rewritten against local aliases, so there is no runtime dependency.

**Why here.** `components.json` is already set up, so adopting it is one `npx shadcn add` and a
registry entry.

**What blocks it.** Nothing technical — it is that there is not much to collapse. The web app is
about 3,300 lines with one dialog and one shell (`app-shell.tsx`, `mcp-dialog.tsx`), and it is
not re-deriving the shapes the registry exists to hold. Adopting it now would be a rewrite of
working code for consistency with other apps rather than for less code here.

**Before it goes in:** wait for the second dialog, or the first page that wants a real header
with a trail and a control row. Then take the shell rather than writing a third variant.

## Looked at and ruled out

**`@vantreeseba/graphql-casl-directives`** — declares permissions as `@can`/`@rule` directives
in SDL. There is no SDL here to annotate: the schema is generated from the Drizzle tables at
runtime, and `schema.graphql` is an *output* that CI diffs for drift. The map in
`permissions.ts` is the form this repo can actually hold.

**`@vantreeseba/graphql-casl-codegen`** (published, 1.10.0) — emits CASL subject bindings from
generated resolver types. This repo emits none: codegen here is client documents only, and
adding `typescript-resolvers` over the whole generated surface to derive a union of seven names
is a build for nothing. The reasoning is in `permissions.ts` beside the hand-written union.

**`graphql-mocks`** — `AGENTS.md` forbids mocking the database; the tests run real PGlite and a
real stdio MCP fixture, which is why they catch what they catch.

**`min-agent`** — a private application, not a library, and the `min-agent` on npm belongs to
someone else. It already frames this server in its sidebar. Worth noting for one reason: its
runner solves the same problem as `server/runner/agent.ts` — an OpenAI-compatible stream with
MCP tools attached, retried only before the first chunk. If either ever needs the other's fixes,
that loop is the thing to extract into a package, and neither is that package today.

## Not libraries: the MCP servers next door

`ai_tools/mcp/` holds `mcp-router`, `mcp-search`, `mcp-skills-manager`, `mcp-actual` and
`google-mcp-suite`. These are rows in the `mcp_servers` table, not dependencies. `mcp-router` is
the one with an architectural bearing: it is a gateway, so pointing this server's pool at one
router instead of at five stdio children would move tool-budget management — the whole reason
`toolDiscovery` and `toolSelectModel` exist — out of this server and behind one connection.
