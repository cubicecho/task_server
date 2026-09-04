import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DeleteTaskDocument,
  RunTaskDocument,
  StopTaskDocument,
  type TaskFieldsFragment,
  TasksDocument,
  UpdateTaskDocument,
} from "@/__generated__/graphql/graphql";
import { Page } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { request } from "@/lib/gql";
import { STATUS_VARIANT } from "@/lib/run-status";

export function TasksRoute() {
  const queryClient = useQueryClient();

  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => request(TasksDocument),
    // A run started by cron, or by another tab, only shows up if we look. Polling while
    // anything is running is what makes the Stop button appear — and disappear again.
    refetchInterval: (query) =>
      query.state.data?.tasks.some((task) => task.runs[0]?.status === "running") ? 2000 : false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tasks"] });

  const toggle = useMutation({
    mutationFn: (task: TaskFieldsFragment) =>
      request(UpdateTaskDocument, { id: task.id, set: { enabled: !task.enabled } }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => request(DeleteTaskDocument, { id }),
    onSuccess: () => {
      toast.success("Task deleted");
      refresh();
    },
  });

  const stop = useMutation({
    mutationFn: (taskId: string) => request(StopTaskDocument, { taskId }),
    onSuccess: (data) => {
      // False means the run had already finished on its own — nothing was stopped, and the
      // refresh below is what the user actually wanted to see.
      if (data.stopTask) toast.success("Stopping…");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });

  const run = useMutation({
    mutationFn: (taskId: string) => request(RunTaskDocument, { taskId }),
    onSuccess: (data) => {
      const { status, error } = data.runTask;
      if (status === "error") toast.error(error || "Run failed");
      else if (status === "stopped") toast.success("Run stopped");
      else toast.success("Run finished — see Runs for the output");
      refresh();
    },
  });

  // The scheduler is the authority on when a trigger next fires; the trigger row only holds
  // the expression it was built from.
  const nextRuns = new Map(tasks.data?.schedule.map((entry) => [entry.triggerId, entry.nextRun]));

  return (
    <Page
      title="Tasks"
      description="A prompt, and the triggers that decide when it runs."
      actions={
        <Button asChild>
          <Link to="/tasks/new">
            <Plus className="size-4" />
            New task
          </Link>
        </Button>
      }
    >
      {tasks.isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {tasks.error ? (
        <p className="text-sm text-destructive">{(tasks.error as Error).message}</p>
      ) : null}
      {tasks.data?.tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tasks yet. Create one, give it a cron expression, and it runs on its own.
        </p>
      ) : null}

      {tasks.data?.tasks.map((task) => {
        // The last run that actually ran: a `skipped` row is a trigger firing at this very
        // task while it was busy, so taking it as the latest would hide the run it collided
        // with — the running one, whose Stop button is the thing someone wants at that moment.
        // Skips are the Runs page's to show.
        const lastRun = task.runs[0];
        // `runTask` resolves only when the run finishes, so the mutation being in flight is a
        // run in flight too — before the poll has had a chance to see the row.
        const running =
          lastRun?.status === "running" || (run.isPending && run.variables === task.id);
        return (
          <Card key={task.id} className="gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-medium">{task.name}</h2>
                  {lastRun ? (
                    <Badge variant={STATUS_VARIANT[lastRun.status] ?? "secondary"}>
                      {lastRun.status}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.prompt}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch
                  checked={task.enabled}
                  onCheckedChange={() => toggle.mutate(task)}
                  aria-label="Enabled"
                />
                {running ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Stop this run"
                    disabled={stop.isPending}
                    onClick={() => stop.mutate(task.id)}
                  >
                    <Square className="size-4" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Run now"
                    disabled={run.isPending}
                    onClick={() => run.mutate(task.id)}
                  >
                    <Play className="size-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" title="Edit" asChild>
                  <Link to="/tasks/$taskId" params={{ taskId: task.id }}>
                    <Pencil className="size-4" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={running ? "Stop the run before deleting" : "Delete"}
                  disabled={running}
                  onClick={() => remove.mutate(task.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {task.triggers.length === 0 ? (
                <span>No triggers — it only runs when you press play.</span>
              ) : null}
              {task.triggers.map((trigger) => {
                // A webhook has no next time to show and is not waiting on the scheduler: it
                // fires when someone posts to it. Saying "not scheduled" of one reads as a
                // fault, when it is simply a different kind of trigger.
                if (trigger.kind === "event") {
                  return (
                    <span key={trigger.id} className="rounded-md border px-2 py-1 font-mono">
                      POST /webhooks/{trigger.event}
                    </span>
                  );
                }
                const next = nextRuns.get(trigger.id);
                return (
                  <span
                    key={trigger.id}
                    className="rounded-md border px-2 py-1 font-mono"
                    title={next ? `next: ${new Date(next).toLocaleString()}` : undefined}
                  >
                    {trigger.cron}
                    {trigger.timezone ? ` (${trigger.timezone})` : ""}
                    {next ? ` · next ${new Date(next).toLocaleString()}` : " · not scheduled"}
                  </span>
                );
              })}
              {task.model ? <span className="px-1 py-1">model: {task.model}</span> : null}
            </div>
          </Card>
        );
      })}
    </Page>
  );
}
