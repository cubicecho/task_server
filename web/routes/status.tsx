import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RunTaskDocument, StatusDocument, type StatusQuery } from "@/__generated__/graphql/graphql";
import { Page } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { request } from "@/lib/gql";
import { HEALTH, type Health, type StatusTask, tally, taskHealth, WRONG } from "@/lib/task-health";
import { cn } from "@/lib/utils";

type Failure = StatusQuery["failures"][number];
type Server = StatusQuery["mcpStatus"][number];

const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * What each heap is called, and what being in it means.
 *
 * The blurb is the point of the tile as much as the number is: "Manual only" is a count of
 * tasks that will never happen on their own, which is a thing to know and not a thing to fix,
 * and a page that only showed the figure would read as an alarm.
 */
const LABELS: Record<Health, { label: string; blurb: string; tone: string }> = {
  refused: {
    label: "Turned away",
    blurb:
      "A firing was refused and nothing has run since: the task was already running, and a " +
      "second copy of work in flight is not something to queue.",
    tone: "text-destructive",
  },
  broken: {
    label: "Broken",
    blurb: "The last run ended in an error. A cron task will try again; a webhook waits.",
    tone: "text-destructive",
  },
  running: { label: "Running", blurb: "In flight right now.", tone: "" },
  waiting: {
    label: "Waiting",
    blurb:
      "A firing found the server at its limit and is queued. Nothing is lost — it starts when " +
      "a slot comes back — but the task is behind.",
    tone: "",
  },
  off: { label: "Off", blurb: "Disabled. Nothing fires it and nothing will.", tone: "" },
  manual: {
    label: "Manual only",
    blurb: "Enabled, but no trigger is armed — it runs when you press play and not otherwise.",
    tone: "",
  },
  fine: { label: "Fine", blurb: "Armed, and the last run finished without complaint.", tone: "" },
};

/** The one line under a task's name: why it is in the heap it is in. */
function Why({ task, health }: { task: StatusTask; health: Health }) {
  const last = task.last[0];
  const collision = task.collision[0];

  if (health === "refused" && collision) {
    const firings = collision.attempts === 1 ? "One firing" : `${collision.attempts} firings`;
    return (
      <p className="text-sm text-destructive">
        {firings} turned away, the last at {when(collision.finishedAt ?? collision.startedAt)}.{" "}
        {collision.error}
      </p>
    );
  }
  if (health === "broken" && last) {
    return (
      <p className="line-clamp-3 text-sm text-destructive">
        {last.error || "It broke without saying why."}
      </p>
    );
  }
  if (health === "running" && last) {
    return <p className="text-sm text-muted-foreground">Started {when(last.startedAt)}.</p>;
  }
  if (health === "waiting" && task.waiting[0]) {
    const queued = task.waiting[0];
    const firings = queued.attempts === 1 ? "A firing" : `${queued.attempts} firings`;
    return (
      <p className="text-sm text-muted-foreground">
        {firings} waiting since {when(queued.startedAt)}. {queued.error}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {last ? `Last run ${last.status} at ${when(last.startedAt)}.` : "Not run yet."}
    </p>
  );
}

function TaskRow({ task, health }: { task: StatusTask; health: Health }) {
  const queryClient = useQueryClient();
  const run = useMutation({
    mutationFn: () => request(RunTaskDocument, { taskId: task.id }),
    onSuccess: () => {
      toast.success(`Started ${task.name}.`);
      queryClient.invalidateQueries({ queryKey: ["status"] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card className="gap-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="font-medium underline">
          {task.name}
        </Link>
        <Badge variant={WRONG.includes(health) ? "destructive" : "outline"}>
          {LABELS[health].label}
        </Badge>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          // Nothing is gained by offering to start a task that is already going: `runTask`
          // refuses one, and the refusal would arrive as a toast saying so.
          disabled={health === "running" || run.isPending}
          onClick={() => run.mutate()}
        >
          <Play className="size-3.5" />
          Run now
        </Button>
      </div>
      <Why task={task} health={health} />
    </Card>
  );
}

function FailureRow({ failure }: { failure: Failure }) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {failure.task ? (
          <Link
            to="/tasks/$taskId"
            params={{ taskId: failure.task.id }}
            className="font-medium underline"
          >
            {failure.task.name}
          </Link>
        ) : (
          <span className="font-medium">(deleted task)</span>
        )}
        <span className="text-xs text-muted-foreground">{when(failure.startedAt)}</span>
      </div>
      <p className="line-clamp-2 text-sm text-destructive">
        {failure.error || "It broke without saying why."}
      </p>
    </Card>
  );
}

function Tile({
  health,
  count,
  selected,
  onSelect,
}: {
  health: Health;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { label, blurb, tone } = LABELS[health];
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={blurb}
      onClick={onSelect}
      className={cn(
        "rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected && "border-primary bg-accent",
      )}
    >
      <div className={cn("text-2xl font-semibold tabular-nums", count > 0 && tone)}>{count}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
}

export function StatusRoute() {
  const [selected, setSelected] = useState<Health | null>(null);
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ["status"],
    queryFn: () => request(StatusDocument),
    refetchInterval: 10_000,
  });

  const tasks = status.data?.tasks ?? [];
  const counts = tally(tasks);

  // With nothing picked the list is the tasks something is wrong with, because that is the
  // question the page was opened to answer. Picking a tile is how you ask a narrower one — and
  // how you see the heaps that are not problems at all.
  const shown = tasks.filter((task) => {
    const health = taskHealth(task);
    return selected ? health === selected : WRONG.includes(health);
  });

  // A task standing in `broken` already says its own error, so a run listed there as well would
  // be the same fault twice. What is left is the failures nothing else accounts for: a task
  // that has run successfully since, or one that has been deleted.
  const accounted = new Set(
    tasks.filter((task) => taskHealth(task) === "broken").map((task) => task.id),
  );
  const unexplained = (status.data?.failures ?? []).filter(
    (failure) => !failure.task || !accounted.has(failure.task.id),
  );

  const unreachable = (status.data?.mcpStatus ?? []).filter(
    (server: Server) => server.status === "error",
  );

  return (
    <Page
      title="Status"
      description="What is wrong, and what is about to be."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["status"] })}
          disabled={status.isFetching}
        >
          <RefreshCw className={cn("size-4", status.isFetching && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      {status.error ? (
        <p className="text-sm text-destructive">{(status.error as Error).message}</p>
      ) : null}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        {HEALTH.map((health) => (
          <Tile
            key={health}
            health={health}
            count={counts[health]}
            selected={selected === health}
            onSelect={() => setSelected(selected === health ? null : health)}
          />
        ))}
      </div>

      {selected ? <p className="text-sm text-muted-foreground">{LABELS[selected].blurb}</p> : null}

      {unreachable.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold">Servers that did not connect</h2>
            <p className="text-sm text-muted-foreground">
              Enabled, and not reached. Every run since has gone out without these tools, whether or
              not its prompt was written expecting them.
            </p>
          </div>
          {unreachable.map((server) => (
            <Card key={server.id} className="gap-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{server.label || server.slug}</span>
                <Badge variant="destructive">{server.status}</Badge>
                <Button asChild size="sm" variant="outline" className="ml-auto">
                  <Link to="/servers">Servers</Link>
                </Button>
              </div>
              <p className="line-clamp-2 text-sm text-destructive">{server.error}</p>
            </Card>
          ))}
        </section>
      ) : null}

      {shown.length > 0 ? (
        <section className="flex flex-col gap-2">
          {shown.map((task) => (
            <TaskRow key={task.id} task={task} health={taskHealth(task)} />
          ))}
        </section>
      ) : null}

      {!status.isPending && shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {selected
            ? `Nothing is ${LABELS[selected].label.toLowerCase()}.`
            : tasks.length === 0
              ? "No tasks yet."
              : `Nothing needs you. ${counts.running} running, ${counts.fine} armed and well.`}
        </p>
      ) : null}

      {unexplained.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold">Failures with nothing standing behind them</h2>
            <p className="text-sm text-muted-foreground">
              Runs that broke and whose task has run since, or whose task is gone. Nothing above
              counts these, and they are worth seeing once.
            </p>
          </div>
          {unexplained.slice(0, 5).map((failure) => (
            <FailureRow key={failure.id} failure={failure} />
          ))}
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link to="/runs">Every run</Link>
          </Button>
        </section>
      ) : null}
    </Page>
  );
}
