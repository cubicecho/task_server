import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RunTaskDocument, StatusDocument, type StatusQuery } from "@/__generated__/graphql/graphql";
import { PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-state";
import { Section } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
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
      <ItemDescription className="text-destructive">
        {firings} turned away, the last at {when(collision.finishedAt ?? collision.startedAt)}.{" "}
        {collision.error}
      </ItemDescription>
    );
  }
  if (health === "broken" && last) {
    return (
      <ItemDescription className="line-clamp-3 text-destructive">
        {last.error || "It broke without saying why."}
      </ItemDescription>
    );
  }
  if (health === "running" && last) {
    return <ItemDescription>Started {when(last.startedAt)}.</ItemDescription>;
  }
  if (health === "waiting" && task.waiting[0]) {
    const queued = task.waiting[0];
    const firings = queued.attempts === 1 ? "A firing" : `${queued.attempts} firings`;
    return (
      <ItemDescription>
        {firings} waiting since {when(queued.startedAt)}. {queued.error}
      </ItemDescription>
    );
  }
  return (
    <ItemDescription>
      {last ? `Last run ${last.status} at ${when(last.startedAt)}.` : "Not run yet."}
    </ItemDescription>
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
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>
          <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="underline">
            {task.name}
          </Link>
          <Badge variant={WRONG.includes(health) ? "destructive" : "outline"}>
            {LABELS[health].label}
          </Badge>
        </ItemTitle>
        <Why task={task} health={health} />
      </ItemContent>
      <ItemActions>
        <Button
          size="sm"
          variant="outline"
          // Nothing is gained by offering to start a task that is already going: `runTask`
          // refuses one, and the refusal would arrive as a toast saying so.
          disabled={health === "running" || run.isPending}
          onClick={() => run.mutate()}
        >
          <Play className="size-3.5" />
          Run now
        </Button>
      </ItemActions>
    </Item>
  );
}

function FailureRow({ failure }: { failure: Failure }) {
  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>
          {failure.task ? (
            <Link to="/tasks/$taskId" params={{ taskId: failure.task.id }} className="underline">
              {failure.task.name}
            </Link>
          ) : (
            <span>(deleted task)</span>
          )}
          <span className="font-normal text-muted-foreground text-xs">
            {when(failure.startedAt)}
          </span>
        </ItemTitle>
        <ItemDescription className="line-clamp-2 text-destructive">
          {failure.error || "It broke without saying why."}
        </ItemDescription>
      </ItemContent>
    </Item>
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
        "rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary bg-accent",
      )}
    >
      <div className={cn("font-semibold text-2xl tabular-nums", count > 0 && tone)}>{count}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
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
    <PageLayout
      title="Status"
      description="What is wrong, and what is about to be."
      action={
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
      content={
        <>
          {status.isError ? (
            <QueryError
              error={status.error}
              onRetry={() => status.refetch()}
              what="the status of your tasks"
            />
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

          {selected ? (
            <p className="text-muted-foreground text-sm">{LABELS[selected].blurb}</p>
          ) : null}

          {unreachable.length > 0 ? (
            <Section
              title="Unreachable servers"
              description="Enabled, and not reached. Every run since has gone out without these tools, whether or not its prompt was written expecting them."
              content={unreachable.map((server) => (
                <Item key={server.id} variant="outline">
                  <ItemContent>
                    <ItemTitle>
                      {server.label || server.slug}
                      <Badge variant="destructive">{server.status}</Badge>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-2 text-destructive">
                      {server.error}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/servers">Servers</Link>
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            />
          ) : null}

          {shown.map((task) => (
            <TaskRow key={task.id} task={task} health={taskHealth(task)} />
          ))}

          {!status.isPending && shown.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {selected
                ? `Nothing is ${LABELS[selected].label.toLowerCase()}.`
                : tasks.length === 0
                  ? "No tasks yet."
                  : `Nothing needs you. ${counts.running} running, ${counts.fine} armed and well.`}
            </p>
          ) : null}

          {unexplained.length > 0 ? (
            <Section
              title="Unexplained failures"
              description="Runs that broke and whose task has run since, or whose task is gone. Nothing above counts these, and they are worth seeing once."
              content={
                <>
                  {unexplained.slice(0, 5).map((failure) => (
                    <FailureRow key={failure.id} failure={failure} />
                  ))}
                  <Button asChild variant="outline" size="sm" className="self-start">
                    <Link to="/runs">Every run</Link>
                  </Button>
                </>
              }
            />
          ) : null}
        </>
      }
    />
  );
}
