import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  type AgentFieldsFragment,
  AgentsDocument,
  DeleteAgentDocument,
} from "@/__generated__/graphql/graphql";
import { ActionButton } from "@/components/action-button";
import { AgentDialog } from "@/components/agent-dialog";
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
import { request } from "@/lib/gql";

/**
 * What this profile changes, said in the badges rather than in a second form.
 *
 * A profile is mostly inherit, so listing what it *is* would be listing the settings page. The
 * card says only where it differs, which is the whole reason the row exists.
 */
function overrides(agent: AgentFieldsFragment): string[] {
  const said: string[] = [];
  if (agent.baseUrl) said.push(agent.baseUrl);
  if (agent.model) said.push(agent.model);
  if (agent.systemPrompt) said.push("system prompt");
  if (agent.maxTokens >= 0) said.push(`${agent.maxTokens} tokens`);
  if (agent.temperature >= 0) said.push(`temp ${agent.temperature}`);
  if (agent.maxToolIterations >= 0) said.push(`${agent.maxToolIterations} tool steps`);
  if (agent.toolDiscovery !== "inherit") said.push(agent.toolDiscovery);
  if (agent.toolSelectModel) said.push(`picks tools with ${agent.toolSelectModel}`);
  if (agent.requestTimeoutSeconds >= 0) said.push(`${agent.requestTimeoutSeconds}s of silence`);
  if (agent.maxRetries >= 0) said.push(`${agent.maxRetries} retries`);
  return said;
}

export function AgentsRoute() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AgentFieldsFragment | null>(null);
  const [creating, setCreating] = useState(false);

  const agents = useQuery({ queryKey: ["agents"], queryFn: () => request(AgentsDocument) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["agents"] });
    // A deleted profile unsets `agentId` on every task that named it, and both task views show
    // which profile a task runs on.
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => request(DeleteAgentDocument, { id }),
    onSuccess: refresh,
  });

  const servers = agents.data?.mcpServers ?? [];
  const rows = agents.data?.agents ?? [];

  return (
    <PageLayout
      title="Agent profiles"
      description="A named set of overrides for Settings, that a task can be pointed at."
      action={
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New profile
        </Button>
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

          {creating ? (
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
