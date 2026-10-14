import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { StatusDocument, type StatusQuery } from "@/__generated__/graphql/graphql";
import { List } from "@/components/list";
import { PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-state";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, RefreshCw } from "@/components/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { request } from "@/lib/gql";
import {
  HEALTH,
  type Health,
  type StatusTask,
  tally,
  taskHealth,
  tasksShown,
  unexplainedFailures,
  WRONG,
} from "@/lib/task-health";
import { useRunTask } from "@/lib/use-task-run";

type Failure = StatusQuery["failures"][number];
type Server = StatusQuery["mcpStatus"][number];

/** A failed run whose `error` is empty still has to say something. */
const NO_REASON = "It broke without saying why.";

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
    tone: "text-negative",
  },
  broken: {
    label: "Broken",
    blurb: "The last run ended in an error. A cron task will try again; a webhook waits.",
    tone: "text-negative",
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
      <ItemDescription className="text-negative">
        {firings} turned away, the last at {when(collision.finishedAt ?? collision.startedAt)}.{" "}
        {collision.error}
      </ItemDescription>
    );
  }
  if (health === "broken" && last) {
    return (
      <ItemDescription className="line-clamp-3 text-negative">
        {last.error || NO_REASON}
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
  const run = useRunTask();

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
          onClick={() => run.mutate({ taskId: task.id })}
          iconSlot={<Play />}
          content="Run now"
        />
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
          <span className="font-normal text-foreground/60 text-xs">{when(failure.startedAt)}</span>
        </ItemTitle>
        <ItemDescription className="line-clamp-2 text-negative">
          {failure.error || NO_REASON}
        </ItemDescription>
      </ItemContent>
    </Item>
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

  const shown = tasksShown(tasks, selected);
  const unexplained = unexplainedFailures(tasks, status.data?.failures ?? []);

  const unreachable = (status.data?.mcpStatus ?? []).filter(
    (server: Server) => server.status === "error",
  );

  /** What an empty list means: nothing in the chosen heap, no tasks at all, or all is well. */
  const emptyNote = () => {
    if (selected) {
      return `Nothing is ${LABELS[selected].label.toLowerCase()}.`;
    }
    if (tasks.length === 0) {
      return "No tasks yet.";
    }
    return `Nothing needs you. ${counts.running} running, ${counts.fine} armed and well.`;
  };

  return (
    <PageLayout
      title="Status"
      description="What is wrong, and what is about to be."
      actionSlot={
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["status"] })}
          disabled={status.isFetching}
          iconSlot={<RefreshCw className={status.isFetching ? "animate-spin" : undefined} />}
          content="Refresh"
        />
      }
      contentSlot={
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
              <StatTile
                key={health}
                label={LABELS[health].label}
                value={counts[health]}
                valueClassName={counts[health] > 0 ? LABELS[health].tone : undefined}
                selected={selected === health}
                onClick={() => setSelected(selected === health ? null : health)}
              />
            ))}
          </div>

          {selected ? <p className="text-foreground/60 text-sm">{LABELS[selected].blurb}</p> : null}

          {unreachable.length > 0 ? (
            <Section
              title="Unreachable servers"
              description="Enabled, and not reached. Every run since has gone out without these tools, whether or not its prompt was written expecting them."
              contentSlot={unreachable.map((server) => (
                <Item key={server.id} variant="outline">
                  <ItemContent>
                    <ItemTitle>
                      {server.label || server.slug}
                      <Badge variant="destructive">{server.status}</Badge>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-2 text-negative">
                      {server.error}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      size="sm"
                      variant="outline"
                      linkSlot={<Link to="/settings/servers" />}
                      content="Servers"
                    />
                  </ItemActions>
                </Item>
              ))}
            />
          ) : null}

          <List
            label="Tasks"
            divided={false}
            contentSlot={shown.map((task) => (
              <TaskRow key={task.id} task={task} health={taskHealth(task)} />
            ))}
          />

          {!status.isPending && shown.length === 0 ? (
            <p className="text-foreground/60 text-sm">{emptyNote()}</p>
          ) : null}

          {unexplained.length > 0 ? (
            <Section
              title="Unexplained failures"
              description="Runs that broke and whose task has run since, or whose task is gone. Nothing above counts these, and they are worth seeing once."
              contentSlot={
                <>
                  {unexplained.slice(0, 5).map((failure) => (
                    <FailureRow key={failure.id} failure={failure} />
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    linkSlot={<Link to="/runs" />}
                    content="Every run"
                  />
                </>
              }
            />
          ) : null}
        </>
      }
    />
  );
}
