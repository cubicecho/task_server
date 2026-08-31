import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Page } from "@/components/app-shell";
import { TaskDialog } from "@/components/task-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  DeleteTaskDocument,
  RunTaskDocument,
  StopTaskDocument,
  type TaskFieldsFragment,
  TasksDocument,
  UpdateTaskDocument,
} from "@/gql/graphql";
import { request } from "@/lib/gql";

export function TasksRoute() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<TaskFieldsFragment | null>(null);
  const [creating, setCreating] = useState(false);

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
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => request(DeleteTaskDocument, { id }),
    onSuccess: () => {
      toast.success("Task deleted");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const stop = useMutation({
    mutationFn: (taskId: string) => request(StopTaskDocument, { taskId }),
    onSuccess: (data) => {
      // False means the run had already finished on its own — nothing was stopped, and the
      // refresh below is what the user actually wanted to see.
      if (data.stopTask) toast.success("Stopping…");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
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
    onError: (error: Error) => toast.error(error.message),
  });

  // The scheduler is the authority on when a trigger next fires; the trigger row only holds
  // the expression it was built from.
  const nextRuns = new Map(tasks.data?.schedule.map((entry) => [entry.triggerId, entry.nextRun]));

  return (
    <Page
      title="Tasks"
      description="A prompt, and the triggers that decide when it runs."
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New task
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
                    <Badge
                      variant={
                        lastRun.status === "error"
                          ? "destructive"
                          : lastRun.status === "running"
                            ? "outline"
                            : "secondary"
                      }
                    >
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
                <Button variant="ghost" size="icon" title="Edit" onClick={() => setEditing(task)}>
                  <Pencil className="size-4" />
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
                const next = nextRuns.get(trigger.id);
                return (
                  <span
                    key={trigger.id}
                    className="rounded-md border px-2 py-1 font-mono"
                    title={next ? `next: ${new Date(next).toLocaleString()}` : undefined}
                  >
                    {trigger.kind === "cron" ? trigger.cron : `on ${trigger.event}`}
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

      {creating ? <TaskDialog onClose={() => setCreating(false)} onSaved={refresh} /> : null}
      {editing ? (
        <TaskDialog task={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      ) : null}
    </Page>
  );
}
