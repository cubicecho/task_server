import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  DeleteTaskDocument,
  type TaskFieldsFragment,
  TasksDocument,
  UpdateTaskDocument,
} from "@/__generated__/graphql/graphql";
import { ConfirmButton } from "@/components/confirm-button";
import { PageLayout } from "@/components/page-layout";
import { QueryState } from "@/components/query-state";
import { RunDialog } from "@/components/run-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Pencil, Play, Plus, Square, Trash2 } from "@/components/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { request } from "@/lib/gql";
import { STATUS_VARIANT } from "@/lib/run-status";
import { useRunTask, useStopTask } from "@/lib/use-task-run";

export function TasksRoute() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => request(TasksDocument),
    // A run started by cron, or by another tab, only shows up if we look. Polling while
    // anything is running is what makes the Stop button appear — and disappear again.
    refetchInterval: (query) =>
      query.state.data?.tasks.some((task) => task.runs[0]?.status === "running") ? 2000 : false,
  });
  // A task is drawn on more pages than this one: status counts it, the runs page lists its runs
  // and offers it as a filter, and a profile says which tasks run on it.
  const refresh = () => {
    for (const key of ["tasks", "runs", "status", "agents", "run-filter-tasks"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const toggle = useMutation({
    mutationFn: (task: TaskFieldsFragment) =>
      request(UpdateTaskDocument, { id: task.id, set: { enabled: !task.enabled } }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => request(DeleteTaskDocument, { id }),
    onSuccess: () => {
      toast("Task deleted", "positive");
      refresh();
    },
  });

  const stop = useStopTask();

  // The task a body is being typed for, if any. A task with a webhook is asked for one rather
  // than started outright: its prompt most likely has `{{event}}` in it, and a run with nothing
  // there is a test of half of it.
  const [askFor, setAskFor] = useState<TaskFieldsFragment | null>(null);

  const run = useRunTask();

  // The scheduler is the authority on when a trigger next fires; the trigger row only holds
  // the expression it was built from.
  const nextRuns = new Map(tasks.data?.schedule.map((entry) => [entry.triggerId, entry.nextRun]));

  const press = (task: TaskFieldsFragment) => {
    if (task.triggers.some((trigger) => trigger.kind === "event")) {
      setAskFor(task);
    } else {
      run.mutate({ taskId: task.id });
    }
  };

  const rows = tasks.data?.tasks ?? [];

  // Offered twice: in the header always, and in the empty state where it is the only thing to do.
  const newTask = (
    <Button
      variant="positive"
      linkSlot={<Link to="/tasks/new" />}
      iconSlot={<Plus />}
      content="New task"
    />
  );

  return (
    <PageLayout
      title="Tasks"
      description="A prompt, and the triggers that decide when it runs."
      actionSlot={newTask}
      contentSlot={
        <>
          <QueryState
            query={tasks}
            what="your tasks"
            count={rows.length}
            emptySlot={
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No tasks yet</EmptyTitle>
                  <EmptyDescription>
                    Create one, give it a cron expression, and it runs on its own.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>{newTask}</EmptyContent>
              </Empty>
            }
          />

          {rows.map((task) => {
            // The last run that actually ran: a `skipped` row is a trigger firing at this very
            // task while it was busy, so taking it as the latest would hide the run it collided
            // with — the running one, whose Stop button is the thing someone wants at that
            // moment. Skips are the Runs page's to show.
            const lastRun = task.runs[0];
            // `runTask` resolves only when the run finishes, so the mutation being in flight is
            // a run in flight too — before the poll has had a chance to see the row.
            const running =
              lastRun?.status === "running" || (run.isPending && run.variables?.taskId === task.id);
            return (
              <Item key={task.id} variant="outline" className="flex-col items-stretch gap-3">
                <div className="flex w-full items-start justify-between gap-3">
                  <ItemContent>
                    <ItemTitle>
                      <span className="truncate">{task.name}</span>
                      {lastRun ? (
                        <Badge variant={STATUS_VARIANT[lastRun.status] ?? "secondary"}>
                          {lastRun.status}
                        </Badge>
                      ) : null}
                    </ItemTitle>
                    <ItemDescription className="line-clamp-2">{task.prompt}</ItemDescription>
                  </ItemContent>
                  <ItemActions className="gap-1">
                    <Switch
                      checked={task.enabled}
                      onCheckedChange={() => toggle.mutate(task)}
                      aria-label="Enabled"
                    />
                    {running ? (
                      <Button
                        aria-label="Stop this run"
                        variant="outline"
                        size="icon"
                        // Only this card's button. `isPending` alone is true for the whole list
                        // while any one task is being started or stopped, which greyed out every
                        // other row's control along with the one that was clicked.
                        disabled={stop.isPending && stop.variables === task.id}
                        onClick={() => stop.mutate(task.id)}
                        iconSlot={<Square />}
                      />
                    ) : (
                      <Button
                        aria-label="Run now"
                        variant="outline"
                        size="icon"
                        disabled={run.isPending && run.variables?.taskId === task.id}
                        onClick={() => press(task)}
                        iconSlot={<Play />}
                      />
                    )}
                    <Button
                      aria-label="Edit"
                      variant="outline"
                      size="icon"
                      linkSlot={<Link to="/tasks/$taskId" params={{ taskId: task.id }} />}
                      iconSlot={<Pencil />}
                    />
                    <ConfirmButton
                      aria-label="Delete"
                      variant="destructive-outline"
                      size="icon"
                      hint={running ? "Stop the run before deleting" : undefined}
                      disabled={running}
                      title={`Delete ${task.name}?`}
                      description="Its triggers and its whole run history go with it, output included."
                      onConfirm={() => remove.mutate(task.id)}
                      iconSlot={<Trash2 />}
                    />
                  </ItemActions>
                </div>

                <div className="flex flex-wrap gap-2 text-foreground/60 text-xs">
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
              </Item>
            );
          })}

          {askFor ? (
            <RunDialog
              taskId={askFor.id}
              taskName={askFor.name}
              onClose={() => setAskFor(null)}
              onRun={(payload) => run.mutate({ taskId: askFor.id, payload })}
            />
          ) : null}
        </>
      }
    />
  );
}
