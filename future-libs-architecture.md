# Future libraries

Libraries from the same workshop as the ones this server already runs on, weighed against what
this server actually needs. Written down because the answer to "would this help here?" is worth
keeping once it has been worked out, and because several of the answers are *no* for reasons that
would otherwise be rediscovered.

Nothing here is a plan. It is what was found when each was looked at, and what would have to be
true before it went in. Read it when picking up future work, and correct it when a finding stops
being true — a `no` here is a measurement, not a policy.

Already in: `@vantreeseba/drizzle-graphql`, `@vantreeseba/graphql-casl`,
`@cubicecho/graphql-mcp`, `@cubicecho/graphql-codegen-field-descriptions`, `@cubicecho/cubeui`,
`@cubicecho/agent-core`, `@cubicecho/agent-mcp-pool`.
Those are argued in
[`README.md`](README.md) and [`AGENTS.md`](AGENTS.md); this file is only the ones that are not.

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

**What blocks it.** `0.0.0-development` and unpublished. Nothing else — [#17](https://github.com/cubicecho/task_server/issues/17) is the reminder to finalise the approach once it does.

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

## `@cubicecho/cubeui` — in, and it took the second dialog to earn it

**What it is.** A shadcn registry of the shapes the cubicecho apps kept re-deriving — page and
dialog shells, a query-state wrapper, an icon button with a required accessible name, and a
`FormField` that mints its own ids and wires `aria-describedby`. Components are copied in through
the shadcn CLI and rewritten against the local aliases, so there is no runtime dependency and an
installed file is this repo's to edit.

**Why it went in.** The entry that used to be here said to wait for the second dialog or the
first page with a real header and a control row. Both arrived: agent profiles brought a third
dialog, and the runs page grew a filter bar over a paginated list. By then the page header was
written out five times with four different paddings, `useQuery` was unpacked into a spinner, an
error and an empty state at nine call sites, and every icon button was an accessible name someone
had to remember. Taking the shells deleted `web/components/field.tsx`, collapsed those, and made
the omissions typecheck errors rather than review comments.

**What came with it.** `useAppForm` — a `@tanstack/react-form` hook binding the shadcn controls
to `FormField` — replaced four hand-rolled `useState` forms, which is what moved validation from
a toast on the way out to a message under the input as it is typed. See the frontend section of
[`AGENTS.md`](AGENTS.md) for the conventions; the two sharp edges are that no cubeui component
takes `children` (the body is `content`) and that `ActionButton` and `ConfirmButton` take a
required `label`, which is the accessible name. `ActionButton` used to submit the `<form>` around
it unless the caller passed `type="button"`; [cubeui#18](https://github.com/cubicecho/cubeui/issues/18)
made `type="button"` the default, which is the fix being right rather than the reminder being
remembered.

**What to watch.** The registry is a copy, so an upstream fix does not arrive on its own —
re-running `npx shadcn add @cubeui/<name>` overwrites the local file, and anything edited here
has to be re-applied or, better, pushed upstream. Generic improvements found while using it
belong in cubeui rather than in this repo's copy.

## `@cubicecho/agent-core` and `@cubicecho/agent-mcp-pool` — in, because three copies had drifted

**What they are.** The endpoint-agnostic half of an agent runner, extracted from this server,
`kanban_server` and `min-agent`: the pooled OpenAI client, `timeoutMs`, the retry rules and their
backoff, the tool-schema compatibility pass, on-demand tool loading, the one-shot side tasks, and
the run-event bus. agent-mcp-pool is the MCP connection pool beside it — one long-lived client per
configured server, tools offered to a run as `<slug>__<tool name>`.

**Why they went in.** Not to save lines, though it removed about a thousand. Three servers had
written the same loop and the three copies had begun to disagree, and a disagreement in a retry
rule is not visible until an endpoint is down. The extraction surfaced one immediately: agent-core
had taken the older shape of the side-task hint fallback, a global boolean latched on any error,
where this server had since narrowed it to per-`baseUrl` and 4xx only. That was fixed upstream
with a test, and it is exactly the class of drift that only shows up when the copies are put side
by side.

**Why the seam holds.** Neither package imports anything of this server's. agent-core takes the
narrowest structural config each function reads — an endpoint, a model, a tool policy, a retry
policy — and the Drizzle `Settings` row satisfies all of them, which is why a task's agent profile
still costs the loop no branch. agent-mcp-pool takes a `load()` returning the configured servers,
and here that is a select against `mcp_servers`.

**What was deliberately not taken.** agent-core's context-overflow guard — `requestTokens`,
`isOverflow`, `contextLimitFor`, `compact` — is a feature this server does not have, and adopting
it would change what a run does: a prompt could be refused or silently compacted before it is
sent. That is a product decision about this server's behaviour, not a consequence of taking a
library, so it stays out until it is asked for on its own terms.

**What to watch.** The standing rule is cubeui's, from the other direction. cubeui is copied in,
so an upstream fix has to be pulled; these are depended on, so an upstream fix arrives with the
range — and the corollary is that a fix to retry, tool loading or the event bus belongs *upstream*.
A copy re-grown under `server/runner/` is the drift the extraction was for. agent-mcp-pool is on
`^0.10.0`, where a caret admits only patches, so a minor is a deliberate bump; agent-core is on
`^2.0.1` and its caret takes minors on its own, which is what a stable API is for and is also
the reason a minor there is worth reading the changelog for rather than only the lockfile.

A caution learned taking 2.0.1: `npm view` answers from its cache, and the cached `latest` here
was two majors and three minors behind what the registry actually had. Ask with
`--prefer-online` before concluding a package is already current.

**The two copies that were here have gone home.** `server/runner/agent.ts` used to hold three
things that were not this server's, all filed rather than forgotten, and agent-core 2.x landed
every one of them — so the local copies are deleted rather than maintained, which is the whole
argument for depending on the package:

- `streamStep` — the rearming silence watchdog, the tool-call reassembly and the reasoning-delta
  spellings — is `streamTurn` ([agent-core#6](https://github.com/cubicecho/agent-core/issues/6)).
- `Capabilities` and `negotiate` — the memory of what an endpoint turned out not to support — are
  `capabilitiesFor` and `negotiate` ([agent-core#8](https://github.com/cubicecho/agent-core/issues/8)).
  This server's copy was the one the other two wanted, and it went up as it stood: keyed by
  `baseUrl` rather than a module global, and a loop rather than a single retry.
- The outer retry loop around both is `runTurn`
  ([agent-core#18](https://github.com/cubicecho/agent-core/issues/18)), which is what `agent.ts`
  now calls: one await where a nested loop, a `negotiate` and a `streamStep` used to be.

What is left under `server/runner/` is this server's own — the flow, the profile overlay, the
settings row. There is no known copy outstanding; a new one is a bug, not a stage.

## Looked at and ruled out

**`@vantreeseba/graphql-casl-directives`** — declares permissions as `@can`/`@rule` directives
in SDL. There is no SDL here to annotate: the schema is generated from the Drizzle tables at
runtime, and `schema.graphql` is an *output* that CI diffs for drift. The map in
`permissions.ts` is the form this repo can actually hold.

**`@vantreeseba/graphql-casl-codegen`** (published, 1.10.0) — emits CASL subject bindings from
generated resolver types. This repo emits none: codegen here is client documents only, and
adding `typescript-resolvers` over the whole generated surface to derive a union of seven names
is a build for nothing. The reasoning is in `permissions.ts` beside the hand-written union.

**`@vantreeseba/graphql-zod`** — generates a Zod schema per operation from the typed documents,
which is the right shape for the form validation this app now does by hand. Since the cubeui
adoption every form is `@tanstack/react-form` with per-field validators written out in the
component; a schema derived from the operation the form submits is strictly better than that, so
this one is worth reopening when it can be depended on. Unpublished,
with no release pipeline on its own repo, so there is nothing to depend on. Two things would also
have to be fixed before it could run here, both found by building it and pointing it at this
schema: it stack-overflows on `tasks.graphql`, where `StepInput` and `StepBranchInput` are
mutually recursive and it walks input types with no seen-set (`z.lazy()` is the fix, and the
generated relation filters are the same cycle); and it renders enums as `z.any()`, which lands on
`transport` and `toolDiscovery`, the two enum fields most worth validating. Custom scalars are
not among the problems — a `scalars` map of zod expressions covers all four.

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

Per-tool scope is the same answer, and the line is drawn at the tool. A task that summarises an
inbox has no business holding a shell, and the fix is a router endpoint that does not offer one
rather than a per-tool allow list here: scoping written twice is scoping that disagrees, and the
copy here would only ever cover the servers this pool spawns itself. Which *servers* a run may
reach is a different question and did ship — an agent profile carries `mcpServerIds`, and
`server/runner/mcp.ts` holds a run to it — because that list is this pool's own membership, which
nothing else can answer for it. A profile pointed at one router endpoint is how the two meet: the
server list picks the door, and what is behind it is the router's to scope, for every app in the
ecosystem rather than for this one. Decided on
[#21](https://github.com/cubicecho/task_server/issues/21).
