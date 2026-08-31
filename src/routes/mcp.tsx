import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Page } from "@/components/app-shell";
import { McpDialog } from "@/components/mcp-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DeleteMcpServerDocument,
  McpServersDocument,
  type McpServersQuery,
  ReconnectMcpDocument,
} from "@/gql/graphql";
import { request } from "@/lib/gql";

type McpServer = McpServersQuery["mcpServers"][number];

export function McpRoute() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [creating, setCreating] = useState(false);

  // A stdio server takes a second or two to start, so its status arrives after the row does.
  const servers = useQuery({
    queryKey: ["mcp"],
    queryFn: () => request(McpServersDocument),
    refetchInterval: 5000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["mcp"] });

  const reconnect = useMutation({
    mutationFn: () => request(ReconnectMcpDocument),
    onSuccess: () => {
      toast.success("Reconnecting");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => request(DeleteMcpServerDocument, { id }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const statusOf = (id: string) => servers.data?.mcpStatus.find((entry) => entry.id === id);

  return (
    <Page
      title="MCP servers"
      description="The tools every task can reach, named slug__tool-name."
      actions={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => reconnect.mutate()} disabled={reconnect.isPending}>
            <RefreshCw className="size-4" />
            Reconnect all
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New server
          </Button>
        </div>
      }
    >
      {servers.data?.mcpServers.length === 0 ? (
        <Card className="items-center gap-2 p-8 text-center">
          <Plug className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No servers yet. Without one a task can think, but not act.
          </p>
        </Card>
      ) : null}

      {servers.data?.mcpServers.map((server) => {
        const status = statusOf(server.id);
        const tools = status?.tools ?? [];
        return (
          <Card key={server.id} className="gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-sm font-medium">{server.slug}</span>
                  <Badge variant="outline">{server.transport}</Badge>
                  <Badge variant={status?.status === "ready" ? "secondary" : "outline"}>
                    {status?.status ?? "unknown"}
                  </Badge>
                  {tools.length ? (
                    <span className="text-xs text-muted-foreground">{tools.length} tool(s)</span>
                  ) : null}
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {server.transport === "stdio"
                    ? [server.command, ...((server.args as string[] | null) ?? [])].join(" ")
                    : server.url}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setEditing(server)}>
                <Pencil className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => remove.mutate(server.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>

            {status?.error ? (
              <p className="whitespace-pre-wrap font-mono text-xs text-destructive">
                {status.error}
              </p>
            ) : null}
          </Card>
        );
      })}

      {creating ? (
        <McpDialog onClose={() => setCreating(false)} onSaved={refresh} />
      ) : editing ? (
        <McpDialog server={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      ) : null}
    </Page>
  );
}
