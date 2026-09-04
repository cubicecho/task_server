import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  DeleteRunDocument,
  RunsDocument,
  type RunsQuery,
  StopTaskDocument,
} from "@/__generated__/graphql/graphql";
import { Page } from "@/components/app-shell";
import { RunStream } from "@/components/run-stream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { request } from "@/lib/gql";
import { STATUS_VARIANT } from "@/lib/run-status";

type Run = RunsQuery["runs"][number];
type RunStep = Run["steps"][number];

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
  return <span className="shrink-0 font-mono text-xs text-muted-foreground">{label}</span>;
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
            <span className="text-sm font-medium">{step.name}</span>
            {step.kind === "decision" ? (
              <span className="font-mono text-xs text-muted-foreground">
                → {step.branch || "(undecided)"}
              </span>
            ) : null}
            {step.totalTokens ? (
              <span className="text-xs text-muted-foreground">{step.totalTokens} tokens</span>
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

export function RunsRoute() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);

  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => request(RunsDocument, { taskId: null }),
    // A run started elsewhere — by cron, or by an agent over MCP — should show up without a
    // reload, and this page is cheap enough to poll.
    refetchInterval: 5000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => request(DeleteRunDocument, { id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs"] }),
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
    <Page
      title="Runs"
      description="Every execution, newest first."
      actions={
        <Button
          variant="outline"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["runs"] })}
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      }
    >
      {runs.data?.runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has run yet.</p>
      ) : null}

      {runs.data?.runs.map((run) => {
        const expanded = open === run.id;
        const running = run.status === "running";
        // A trigger that fired at a busy task: a real delivery, and nothing behind it to open.
        const skipped = run.status === "skipped";
        return (
          <Card key={run.id} className="gap-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setOpen(expanded ? null : run.id)}
              >
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[run.status] ?? "secondary"}>{run.status}</Badge>
                  <span className="truncate font-medium">{run.task.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(run.startedAt).toLocaleString()}
                    {skipped ? "" : ` · ${duration(run.startedAt, run.finishedAt)}`}
                    {run.totalTokens ? ` · ${run.totalTokens} tokens` : ""}
                    {/* Only worth saying when the row stands for more than the one firing. */}
                    {run.attempts > 1 ? ` · ${run.attempts}×` : ""}
                  </span>
                  <Provenance trigger={run.trigger} />
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {run.error || run.output || "(no output)"}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                {running ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Stop this run"
                    disabled={stop.isPending}
                    onClick={() => stop.mutate(run.taskId)}
                  >
                    <Square className="size-4" />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  title={running ? "Stop the run before deleting" : "Delete"}
                  disabled={running}
                  onClick={() => remove.mutate(run.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>

            {expanded ? (
              <div className="flex flex-col gap-2 border-t pt-3">
                {/* A run in flight has no stored output yet — this is the run itself, live. */}
                {running ? <RunStream runId={run.id} /> : null}
                {skipped ? (
                  <p className="text-sm text-muted-foreground">
                    {run.attempts > 1
                      ? `The trigger fired ${run.attempts} times while this task was already running, so nothing was started.`
                      : "The trigger fired while this task was already running, so nothing was started."}{" "}
                    {/* Not "the run above": the list is newest first, so the run it collided
                        with — which started before it — is below. Naming neither is safer. */}
                    It collided with the run that was already under way.
                  </p>
                ) : null}
                <Payload payload={run.payload} />
                {running || skipped ? null : run.steps.length ? (
                  <>
                    <RunSteps steps={run.steps} />
                    {/* The run failed before or between steps — nothing above says why. */}
                    {run.error ? <p className="text-sm text-destructive">{run.error}</p> : null}
                  </>
                ) : (
                  <>
                    <ToolChips calls={run.toolCalls} />
                    <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
                      {run.error || run.output || "(no output)"}
                    </pre>
                  </>
                )}
              </div>
            ) : null}
          </Card>
        );
      })}
    </Page>
  );
}
