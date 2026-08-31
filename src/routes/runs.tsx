import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Page } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeleteRunDocument, RunsDocument } from "@/gql/graphql";
import { request } from "@/lib/gql";

const duration = (from: string, to?: string | null) =>
  to ? `${((new Date(to).getTime() - new Date(from).getTime()) / 1000).toFixed(1)}s` : "running…";

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
    onError: (error: Error) => toast.error(error.message),
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
        const tools = (run.toolCalls ?? []) as { name: string; ok: boolean }[];
        const expanded = open === run.id;
        return (
          <Card key={run.id} className="gap-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setOpen(expanded ? null : run.id)}
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      run.status === "error"
                        ? "destructive"
                        : run.status === "running"
                          ? "outline"
                          : "secondary"
                    }
                  >
                    {run.status}
                  </Badge>
                  <span className="truncate font-medium">{run.task.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(run.startedAt).toLocaleString()} ·{" "}
                    {duration(run.startedAt, run.finishedAt)}
                    {run.totalTokens ? ` · ${run.totalTokens} tokens` : ""}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {run.error || run.output || "(no output)"}
                </p>
              </button>
              <Button variant="ghost" size="icon" onClick={() => remove.mutate(run.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>

            {expanded ? (
              <div className="flex flex-col gap-2 border-t pt-3">
                {tools.length ? (
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
                ) : null}
                <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
                  {run.error || run.output || "(no output)"}
                </pre>
              </div>
            ) : null}
          </Card>
        );
      })}
    </Page>
  );
}
