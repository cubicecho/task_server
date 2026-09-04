import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Pencil,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  DeleteMcpServerDocument,
  type McpProbe,
  McpServersDocument,
  type McpServersQuery,
  ReconnectMcpDocument,
  TestMcpServerDocument,
  UpdateMcpServerDocument,
} from "@/__generated__/graphql/graphql";
import { Page } from "@/components/app-shell";
import { McpDialog } from "@/components/mcp-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { request } from "@/lib/gql";
import { toConnection } from "@/lib/mcp-config";

type McpServer = McpServersQuery["mcpServers"][number];

export function McpRoute() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [creating, setCreating] = useState(false);
  /** The last test result per server, keyed by id — a test is about one row, not the page. */
  const [probes, setProbes] = useState<Record<string, McpProbe>>({});

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
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      request(UpdateMcpServerDocument, { id, set: { enabled } }),
    // The write reconnects the pool, so the status this row shows is a beat behind the switch.
    onSuccess: refresh,
  });

  const test = useMutation({
    mutationFn: async (server: McpServer) => {
      const { testMcpServer } = await request(TestMcpServerDocument, {
        config: toConnection(server),
      });
      return { id: server.id, probe: testMcpServer };
    },
    onSuccess: ({ id, probe }) => setProbes((current) => ({ ...current, [id]: probe })),
  });

  const remove = useMutation({
    mutationFn: (id: string) => request(DeleteMcpServerDocument, { id }),
    onSuccess: refresh,
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
        const probe = probes[server.id];
        return (
          <Card key={server.id} className="gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className={`min-w-0 flex-1 ${server.enabled ? "" : "opacity-50"}`}>
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
                    ? [server.command, ...(toConnection(server).args ?? [])].join(" ")
                    : server.url}
                </p>
              </div>
              <Switch
                checked={server.enabled}
                onCheckedChange={(enabled) => toggle.mutate({ id: server.id, enabled })}
                aria-label={`Enable ${server.slug}`}
              />
              <Button
                variant="ghost"
                size="icon"
                title="Test connection"
                onClick={() => test.mutate(server)}
                disabled={test.isPending && test.variables?.id === server.id}
              >
                <PlugZap className="size-4" />
              </Button>
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

            {probe ? (
              <div className="flex flex-col gap-2 border-t pt-3 text-sm">
                <div className="flex items-center gap-2">
                  {probe.ok ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )}
                  {probe.ok ? `Connected — ${probe.tools.length} tool(s)` : "Could not connect"}
                </div>
                {probe.ok ? (
                  <div className="flex flex-wrap gap-1">
                    {probe.tools.map((tool) => (
                      <span
                        key={tool.name}
                        title={tool.description}
                        className="rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground"
                      >
                        {tool.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap font-mono text-xs text-destructive">
                    {probe.error}
                  </p>
                )}
              </div>
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
