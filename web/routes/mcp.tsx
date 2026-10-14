import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlugZap } from "lucide-react";
import { useState } from "react";
import {
  DeleteMcpServerDocument,
  McpServersDocument,
  type McpServersQuery,
  ReconnectMcpDocument,
  TestMcpServerDocument,
  UpdateMcpServerDocument,
} from "@/__generated__/graphql/graphql";
import { ConfirmButton } from "@/components/confirm-button";
import { McpDialog } from "@/components/mcp-dialog";
import { type McpProbe, McpProbeResult } from "@/components/mcp-probe";
import { PageLayout } from "@/components/page-layout";
import { QueryState } from "@/components/query-state";
import { SettingsTabList, SettingsTabsRoot } from "@/components/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Pencil, Plug, Plus, RefreshCw, Trash2 } from "@/components/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { request } from "@/lib/gql";
import { toConnection } from "@/lib/mcp-config";
import { uptime } from "@/lib/uptime";

type McpServer = McpServersQuery["mcpServers"][number];

export function McpRoute() {
  const toast = useToast();
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
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["mcp"] });
    // The profiles page lists these rows as the servers a profile can be scoped to.
    queryClient.invalidateQueries({ queryKey: ["agents"] });
  };

  const reconnect = useMutation({
    mutationFn: () => request(ReconnectMcpDocument),
    onSuccess: () => {
      toast("Reconnecting", "info");
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
  const rows = servers.data?.mcpServers ?? [];

  return (
    <SettingsTabsRoot
      current="servers"
      contentSlot={
        <PageLayout
          title="Settings"
          description="MCP servers: the tools every task can reach, named slug__tool-name."
          headerContentSlot={<SettingsTabList />}
          actionSlot={
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => reconnect.mutate()}
                disabled={reconnect.isPending}
                iconSlot={<RefreshCw />}
                content="Reconnect all"
              />
              <Button
                variant="positive"
                onClick={() => setCreating(true)}
                iconSlot={<Plus />}
                content="New server"
              />
            </div>
          }
          contentSlot={
            <>
              <QueryState
                query={servers}
                what="your MCP servers"
                count={rows.length}
                emptySlot={
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Plug />
                      </EmptyMedia>
                      <EmptyTitle>No servers yet</EmptyTitle>
                      <EmptyDescription>
                        Without one a task can think, but not act.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                }
              />

              {rows.map((server) => {
                const status = statusOf(server.id);
                const tools = status?.tools ?? [];
                const age = status?.startedAt ? uptime(status.startedAt) : null;
                const probe = probes[server.id];
                return (
                  <Item key={server.id} variant="outline" className="flex-col items-stretch gap-3">
                    <div className="flex w-full items-center gap-3">
                      <ItemContent className={server.enabled ? undefined : "opacity-50"}>
                        <ItemTitle>
                          <span className="truncate font-mono">{server.slug}</span>
                          <Badge variant="outline">{server.transport}</Badge>
                          <Badge variant={status?.status === "ready" ? "secondary" : "outline"}>
                            {status?.status ?? "unknown"}
                          </Badge>
                          {tools.length ? (
                            <span className="font-normal text-foreground/60 text-xs">
                              {tools.length} tool(s)
                            </span>
                          ) : null}
                          {/* Only while connected: a pid or an age for a server that is not running
                            names a process that has exited, and a reused pid names someone else's. */}
                          {age ? (
                            <span
                              className="font-normal text-foreground/60 text-xs"
                              title={`connected ${new Date(status?.startedAt ?? "").toLocaleString()}`}
                            >
                              up {age}
                              {status?.pid ? ` · pid ${status.pid}` : ""}
                            </span>
                          ) : null}
                        </ItemTitle>
                        <ItemDescription className="truncate font-mono text-xs">
                          {server.transport === "stdio"
                            ? [server.command, ...(toConnection(server).args ?? [])].join(" ")
                            : server.url}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="gap-1">
                        <Switch
                          checked={server.enabled}
                          onCheckedChange={(enabled) => toggle.mutate({ id: server.id, enabled })}
                          aria-label={`Enable ${server.slug}`}
                        />
                        <Button
                          aria-label="Test connection"
                          variant="outline"
                          size="icon"
                          onClick={() => test.mutate(server)}
                          disabled={test.isPending && test.variables?.id === server.id}
                          iconSlot={<PlugZap />}
                        />
                        <Button
                          aria-label="Edit"
                          variant="outline"
                          size="icon"
                          onClick={() => setEditing(server)}
                          iconSlot={<Pencil />}
                        />
                        <ConfirmButton
                          aria-label="Delete"
                          variant="destructive-outline"
                          size="icon"
                          title={`Delete ${server.slug}?`}
                          description="Every task loses its tools, and any profile scoped to it falls back to the servers that are left."
                          onConfirm={() => remove.mutate(server.id)}
                          iconSlot={<Trash2 />}
                        />
                      </ItemActions>
                    </div>

                    {status?.error ? (
                      <p className="whitespace-pre-wrap font-mono text-negative text-xs">
                        {status.error}
                      </p>
                    ) : null}

                    {probe ? <McpProbeResult probe={probe} /> : null}
                  </Item>
                );
              })}

              {creating ? <McpDialog onClose={() => setCreating(false)} onSaved={refresh} /> : null}
              {editing && !creating ? (
                <McpDialog
                  server={editing}
                  tools={statusOf(editing.id)?.tools}
                  onClose={() => setEditing(null)}
                  onSaved={refresh}
                />
              ) : null}
            </>
          }
        />
      }
    />
  );
}
