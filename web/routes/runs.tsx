import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DeleteRunDocument,
  RunDetailDocument,
  type RunDetailQuery,
  RunFilterTasksDocument,
  RunsDocument,
  type RunsQuery,
  RunsStatusEnum,
  RunTaskDocument,
  StopTaskDocument,
} from "@/__generated__/graphql/graphql";
import { ActionButton } from "@/components/action-button";
import { ConfirmButton } from "@/components/confirm-button";
import { DisclosureRow } from "@/components/disclosure-row";
import { PageLayout } from "@/components/page-layout";
import { QueryState } from "@/components/query-state";
import { RunDialog } from "@/components/run-dialog";
import { RunStream } from "@/components/run-stream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { request } from "@/lib/gql";
import { ANY, buildWhere, type Filters, isFiltered, NO_FILTERS, WINDOWS } from "@/lib/run-filters";
import { STATUS_VARIANT } from "@/lib/run-status";

type Run = RunsQuery["runs"][number];
type RunStep = RunDetailQuery["runs"][number]["steps"][number];

const duration = (from: string, to?: string | null) =>
  to ? `${((new Date(to).getTime() - new Date(from).getTime()) / 1000).toFixed(1)}s` : "running…";

/**
 * What started the run, in as few words as it takes.
 *
 * Nothing at all when there is no trigger: `triggerId` is cleared when a trigger is deleted, so
 * a null there is either a hand-started run or one whose reason has been thrown away, and the
 * page has no way to tell which. Saying "manual" would be a guess presented as a fact.
 */
function Provenance({ trigger }: { trigger: Run["trigger"] }) {
  if (!trigger) return null;
  const label = trigger.kind === "cron" ? trigger.cron : `/webhooks/${trigger.event}`;
  return <span className="shrink-0 font-mono text-muted-foreground text-xs">{label}</span>;
}

/** Tool names as chips, red where the call failed. */
function ToolChips({ calls }: { calls: unknown }) {
  const tools = (calls ?? []) as { name: string; ok: boolean }[];
  if (tools.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tools.map((tool, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a finished run's tool list never changes, and the same tool may appear in it twice
          key={`${tool.name}-${index}`}
          className={`rounded-md border px-2 py-0.5 font-mono text-xs ${
            tool.ok ? "text-muted-foreground" : "border-destructive text-destructive"
          }`}
        >
          {tool.name}
        </span>
      ))}
    </div>
  );
}

/**
 * What the run actually did, step by step.
 *
 * Indented by `depth`, so an arm of a decision reads as being inside it — and the arm each
 * decision took is spelled out, which is the thing you open a branching run to find out.
 */
function RunSteps({ steps }: { steps: readonly RunStep[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step) => (
        <li
          key={step.id}
          className="flex flex-col gap-1 border-l-2 pl-3"
          style={{ marginLeft: `${step.depth * 1}rem` }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[step.status] ?? "secondary"}>{step.status}</Badge>
            <span className="font-medium text-sm">{step.name}</span>
            {step.kind === "decision" ? (
              <span className="font-mono text-muted-foreground text-xs">
                → {step.branch || "(undecided)"}
              </span>
            ) : null}
            {step.totalTokens ? (
              <span className="text-muted-foreground text-xs">{step.totalTokens} tokens</span>
            ) : null}
          </div>
          <ToolChips calls={step.toolCalls} />
          {step.error || step.output ? (
            <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
              {step.error || step.output}
            </pre>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The webhook body the run was given, which is half of why it did what it did.
 *
 * Collapsed by default — most of the page is output, and a payload is an input someone goes
 * looking for rather than reads in passing.
 */
function Payload({ payload }: { payload: unknown }) {
  if (payload === null || payload === undefined) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Event payload</summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}

/**
 * Everything the collapsed card left out, fetched only once the card is opened.
 *
 * These fields are not in the list query on purpose: the steps, tool calls and webhook payload
 * of a hundred runs crossed the wire every five seconds so that one of them could be read.
 *
 * `withResult` is false while the run is still going — `RunStream` is showing it live — and for
 * a `skipped` or `queued` row, neither of which has produced anything: one never will, the other
 * has not yet. The payload is worth showing in all three cases, which is why it is not behind
 * the same flag — it is the body the run will be given when its turn comes.
 */
function RunDetail({
  run,
  withResult,
  onReplay,
}: {
  run: Run;
  withResult: boolean;
  onReplay: (payload: unknown) => void;
}) {
  const detail = useQuery({
    // Keyed on the status as well as the id, so a run that finishes while it is open refetches
    // instead of showing the steps as they stood when it was still running.
    queryKey: ["run", run.id, run.status],
    queryFn: () => request(RunDetailDocument, { id: run.id }),
  });
  const found = detail.data?.runs[0];

  if (!found) {
    return detail.error ? (
      <p className="text-destructive text-sm">{(detail.error as Error).message}</p>
    ) : (
      <p className="text-muted-foreground text-sm">Loading…</p>
    );
  }

  const payload = found.payload;

  return (
    <>
      <Payload payload={payload} />
      {payload === null || payload === undefined ? null : (
        <div>
          {/* The body is the half of a failed delivery that could not be got at: the sender is
              not going to send it again, and it has been sitting on the row all along. */}
          <Button variant="outline" size="sm" onClick={() => onReplay(payload)}>
            <Play className="size-4" />
            Run again with this body
          </Button>
        </div>
      )}
      {!withResult ? null : found.steps.length ? (
        <>
          <RunSteps steps={found.steps} />
          {/* The run failed before or between steps — nothing above says why. */}
          {run.error ? <p className="text-destructive text-sm">{run.error}</p> : null}
        </>
      ) : (
        <>
          <ToolChips calls={found.toolCalls} />
          <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
            {run.error || run.output || "(no output)"}
          </pre>
        </>
      )}
    </>
  );
}

const PAGE = 50;

/**
 * The bar above the list: what to look for, and how far to look.
 *
 * Every control goes through one `onChange`, because each of them also has to put the list back
 * on its first page — a `limit` grown by Load more is about the rows that were on screen, and
 * means nothing once the question changes.
 */
function FilterBar({
  filters,
  onChange,
  tasks,
}: {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  tasks: { id: string; name: string }[];
}) {
  const dirty = isFiltered(filters);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={filters.search}
        onChange={(event) => onChange({ search: event.target.value })}
        aria-label="Search runs"
        placeholder="Search output, errors and task names…"
        className="min-w-56 flex-1"
      />

      <Select value={filters.status} onValueChange={(status) => onChange({ status })}>
        <SelectTrigger className="w-36" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any status</SelectItem>
          {Object.values(RunsStatusEnum).map((status) => (
            <SelectItem key={status} value={status}>
              {status}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.taskId} onValueChange={(taskId) => onChange({ taskId })}>
        <SelectTrigger className="w-44" aria-label="Task">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any task</SelectItem>
          {tasks.map((task) => (
            <SelectItem key={task.id} value={task.id}>
              {task.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.window}
        onValueChange={(value) => {
          const chosen = WINDOWS.find((option) => option.value === value);
          onChange({
            window: value,
            from: chosen?.ms ? new Date(Date.now() - chosen.ms).toISOString() : null,
          });
        }}
      >
        <SelectTrigger className="w-40" aria-label="Time window">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WINDOWS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {dirty ? (
        <ActionButton
          label="Clear filters"
          variant="ghost"
          size="icon"
          onClick={() => onChange(NO_FILTERS)}
        >
          <X />
        </ActionButton>
      ) : null}
    </div>
  );
}

export function RunsRoute() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // The run whose body is being replayed, and the body as it stood when the dialog opened.
  const [replay, setReplay] = useState<{ run: Run; payload: unknown } | null>(null);
  const [limit, setLimit] = useState(PAGE);

  // The typed-in term, a beat behind what is on screen. Without it every keystroke is a query,
  // and the query it is a keystroke of scans the output column of every run ever kept.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(filters.search), 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const where = useMemo(() => buildWhere(filters, search), [filters, search]);
  const filtered = where !== undefined;

  // Names for the task dropdown. Rarely changes, and this page is not where tasks are edited.
  const tasks = useQuery({
    queryKey: ["run-filter-tasks"],
    queryFn: () => request(RunFilterTasksDocument),
    staleTime: 60_000,
  });

  const runs = useQuery({
    queryKey: ["runs", where, limit],
    queryFn: () => request(RunsDocument, { where, limit }),
    // A run started elsewhere — by cron, or by an agent over MCP — should show up without a
    // reload, and the newest page unfiltered is cheap enough to poll for it. Neither half of
    // that holds once you are digging: a poll behind a search re-scans every run that was ever
    // kept, and rows arriving at the top of a list you have paged through move what you are
    // reading. Refresh is the way back to live.
    refetchInterval: filtered || limit > PAGE ? false : 5000,
  });

  const rows = runs.data?.runs ?? [];
  // A short page is the end of the list. A full one may or may not be, and offering to look is
  // cheaper than counting the table to find out.
  const more = rows.length >= limit;

  const update = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setLimit(PAGE);
  };

  const remove = useMutation({
    mutationFn: (id: string) => request(DeleteRunDocument, { id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs"] }),
  });

  const start = useMutation({
    mutationFn: (variables: { taskId: string; payload: unknown }) =>
      request(RunTaskDocument, variables),
    onSuccess: (data) => {
      // `runTask` answers only when the run is over, so by the time this fires there is
      // something to go and read.
      const { status, error } = data.runTask;
      if (status === "error") toast.error(error || "Run failed");
      else if (status === "stopped") toast.success("Run stopped");
      else toast.success("Run finished");
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  // A run is stopped through the task that owns it: the runner keys what is in flight by task.
  const stop = useMutation({
    mutationFn: (taskId: string) => request(StopTaskDocument, { taskId }),
    onSuccess: (data) => {
      // False means it had already finished on its own — the refresh is what shows that.
      if (data.stopTask) toast.success("Stopping…");
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return (
    <PageLayout
      title="Runs"
      description="Every execution, newest first."
      action={
        <Button
          variant="outline"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["runs"] })}
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      }
      headerContent={
        <FilterBar filters={filters} onChange={update} tasks={tasks.data?.tasks ?? []} />
      }
      content={
        <>
          <QueryState
            query={runs}
            what="the run history"
            count={rows.length}
            empty={
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{filtered ? "No matches" : "Nothing has run yet"}</EmptyTitle>
                  <EmptyDescription>
                    {filtered
                      ? "No runs match these filters."
                      : "A run appears here the moment a task starts — by schedule, by webhook, or by hand."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
          />

          {rows.map((run) => {
            const running = run.status === "running";
            // A trigger that fired at a busy task: a real delivery, and nothing behind it to
            // open.
            const skipped = run.status === "skipped";
            // A firing waiting for a slot. Nothing has happened yet, and deleting the row is how
            // you call it off.
            const queued = run.status === "queued";
            return (
              <DisclosureRow
                key={run.id}
                open={open === run.id}
                onOpenChange={(next) => setOpen(next ? run.id : null)}
                badges={
                  <Badge variant={STATUS_VARIANT[run.status] ?? "secondary"}>{run.status}</Badge>
                }
                title={run.task.name}
                meta={
                  <>
                    <span className="shrink-0 font-normal text-muted-foreground text-xs">
                      {new Date(run.startedAt).toLocaleString()}
                      {skipped || queued ? "" : ` · ${duration(run.startedAt, run.finishedAt)}`}
                      {run.totalTokens ? ` · ${run.totalTokens} tokens` : ""}
                      {/* Only worth saying when the row stands for more than the one firing. */}
                      {run.attempts > 1 ? ` · ${run.attempts}×` : ""}
                    </span>
                    <Provenance trigger={run.trigger} />
                  </>
                }
                description={
                  <span className="line-clamp-2">{run.error || run.output || "(no output)"}</span>
                }
                action={
                  <>
                    {running ? (
                      <ActionButton
                        label="Stop this run"
                        variant="ghost"
                        size="icon"
                        // Only this row's button: `isPending` alone disabled every other running
                        // run's Stop while one of them was being stopped.
                        disabled={stop.isPending && stop.variables === run.taskId}
                        onClick={() => stop.mutate(run.taskId)}
                      >
                        <Square />
                      </ActionButton>
                    ) : null}
                    <ConfirmButton
                      label="Delete"
                      variant="ghost"
                      size="icon"
                      hint={running ? "Stop the run before deleting" : undefined}
                      disabled={running}
                      title="Delete this run?"
                      description={
                        queued
                          ? "The firing is called off — it never starts, and nothing is retried in its place."
                          : "Its output, its steps and the webhook body it was given go with it."
                      }
                      onConfirm={() => remove.mutate(run.id)}
                    >
                      <Trash2 />
                    </ConfirmButton>
                  </>
                }
                content={
                  <>
                    {/* A run in flight has no stored output yet — this is the run itself, live. */}
                    {running ? <RunStream runId={run.id} /> : null}
                    {skipped ? (
                      <p className="text-muted-foreground text-sm">
                        {run.attempts > 1
                          ? `The trigger fired ${run.attempts} times while this task was already running, so nothing was started.`
                          : "The trigger fired while this task was already running, so nothing was started."}{" "}
                        {/* Not "the run above": the list is newest first, so the run it collided
                            with — which started before it — is below. Naming neither is safer. */}
                        It collided with the run that was already under way.
                      </p>
                    ) : null}
                    {queued ? (
                      <p className="text-muted-foreground text-sm">
                        {run.attempts > 1
                          ? `The trigger fired ${run.attempts} times while the server was at its limit, and this row stands for all of them.`
                          : "The trigger fired while the server was at its limit."}{" "}
                        It starts on its own when a slot comes back, in this same row — or delete it
                        to call it off. {run.error}
                      </p>
                    ) : null}
                    <RunDetail
                      run={run}
                      withResult={!running && !skipped && !queued}
                      onReplay={(payload) => setReplay({ run, payload })}
                    />
                  </>
                }
              />
            );
          })}

          {more ? (
            <Button
              variant="outline"
              onClick={() => setLimit(limit + PAGE)}
              disabled={runs.isFetching}
            >
              Load {PAGE} more
            </Button>
          ) : null}

          {replay ? (
            <RunDialog
              taskId={replay.run.taskId}
              taskName={replay.run.task.name}
              body={replay.payload}
              onClose={() => setReplay(null)}
              onRun={(payload) => start.mutate({ taskId: replay.run.taskId, payload })}
            />
          ) : null}
        </>
      }
    />
  );
}
