import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import {
  type AgentFieldsFragment,
  AgentSpecDocument,
  AgentsDocument,
  DeleteAgentDocument,
} from "@/__generated__/graphql/graphql";
import { ActionButton } from "@/components/action-button";
import { AgentDialog } from "@/components/agent-dialog";
import { AgentImportDialog } from "@/components/agent-import-dialog";
import { ConfirmButton } from "@/components/confirm-button";
import { PageLayout } from "@/components/page-layout";
import { QueryState } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { overrides, saveFile, specFileName, specText } from "@/lib/agent-spec";
import { request } from "@/lib/gql";

export function AgentsRoute() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AgentFieldsFragment | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const agents = useQuery({ queryKey: ["agents"], queryFn: () => request(AgentsDocument) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["agents"] });
    // A deleted profile unsets `agentId` on every task that named it, and both task views show
    // which profile a task runs on.
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    // A profile's model list is its endpoint's, and a save may have just moved the endpoint.
    queryClient.invalidateQueries({ queryKey: ["models"] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => request(DeleteAgentDocument, { id }),
    onSuccess: refresh,
  });

  // A read, but one made because a button was pressed and whose answer is a file rather than
  // something to show, so it is a mutation to the cache: nothing to keep, and a failure is
  // reported the way every other pressed button's is.
  const exportSpec = useMutation({
    mutationFn: async (agent: AgentFieldsFragment) => {
      const { agentSpec } = await request(AgentSpecDocument, { agentId: agent.id });
      saveFile(specFileName(agent.name), specText(agentSpec));
    },
  });

  const servers = agents.data?.mcpServers ?? [];
  const rows = agents.data?.agents ?? [];

  return (
    <PageLayout
      title="Agent profiles"
      description="A named set of overrides for Settings, that a task can be pointed at."
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImporting(true)}>
            <Upload className="size-4" />
            Import
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New profile
          </Button>
        </div>
      }
      content={
        <>
          <QueryState
            query={agents}
            what="your agent profiles"
            count={rows.length}
            empty={
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Bot />
                  </EmptyMedia>
                  <EmptyTitle>No profiles</EmptyTitle>
                  <EmptyDescription>
                    Every task runs on Settings, which is all a server with one model needs.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
          />

          {rows.map((agent) => {
            const scoped = (agent.mcpServerIds as string[] | null) ?? [];
            const said = overrides(agent);
            return (
              <Item key={agent.id} variant="outline" className="flex-col items-stretch gap-3">
                <div className="flex w-full items-center gap-3">
                  <ItemContent>
                    <ItemTitle>
                      <span className="truncate">{agent.name}</span>
                      <Badge variant="outline">
                        {agent.tasks.length === 1 ? "1 task" : `${agent.tasks.length} tasks`}
                      </Badge>
                      <Badge variant="outline">
                        {scoped.length
                          ? `${scoped.length} of ${servers.length} servers`
                          : "all servers"}
                      </Badge>
                    </ItemTitle>
                    {agent.description ? (
                      <ItemDescription className="truncate">{agent.description}</ItemDescription>
                    ) : null}
                  </ItemContent>
                  <ItemActions className="gap-1">
                    <ActionButton
                      label="Edit"
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditing(agent)}
                    >
                      <Pencil />
                    </ActionButton>
                    <ActionButton
                      label="Export"
                      hint="Save as an agent spec file. It carries no API key."
                      variant="ghost"
                      size="icon"
                      disabled={exportSpec.isPending}
                      onClick={() => exportSpec.mutate(agent)}
                    >
                      <Download />
                    </ActionButton>
                    <ConfirmButton
                      label="Delete"
                      variant="ghost"
                      size="icon"
                      title={`Delete ${agent.name}?`}
                      description={
                        agent.tasks.length
                          ? `The ${agent.tasks.length === 1 ? "task" : `${agent.tasks.length} tasks`} on it fall back to Settings — a different endpoint, key and model.`
                          : "Nothing runs on it, so nothing changes but the list."
                      }
                      onConfirm={() => remove.mutate(agent.id)}
                    >
                      <Trash2 />
                    </ConfirmButton>
                  </ItemActions>
                </div>

                <div className="flex flex-wrap gap-1">
                  {said.length === 0 ? (
                    <span className="text-muted-foreground text-xs">
                      Overrides nothing — a task on it runs exactly as one on Settings.
                    </span>
                  ) : (
                    said.map((one) => (
                      <span
                        key={one}
                        className="rounded-md border px-2 py-0.5 font-mono text-muted-foreground text-xs"
                      >
                        {one}
                      </span>
                    ))
                  )}
                </div>
              </Item>
            );
          })}

          {importing ? (
            <AgentImportDialog
              onClose={() => setImporting(false)}
              onSaved={() => {
                refresh();
                // An import may have created the servers the document bundled.
                queryClient.invalidateQueries({ queryKey: ["mcp"] });
              }}
            />
          ) : creating ? (
            <AgentDialog servers={servers} onClose={() => setCreating(false)} onSaved={refresh} />
          ) : editing ? (
            <AgentDialog
              agent={editing}
              servers={servers}
              onClose={() => setEditing(null)}
              onSaved={refresh}
            />
          ) : null}
        </>
      }
    />
  );
}
