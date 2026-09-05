import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  type AgentFieldsFragment,
  AgentsDocument,
  DeleteAgentDocument,
} from "@/__generated__/graphql/graphql";
import { AgentDialog } from "@/components/agent-dialog";
import { Page } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

  return (
    <Page
      title="Agent profiles"
      description="A named set of overrides for Settings, that a task can be pointed at."
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New profile
        </Button>
      }
    >
      {agents.data?.agents.length === 0 ? (
        <Card className="items-center gap-2 p-8 text-center">
          <Bot className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No profiles. Every task runs on Settings, which is all a server with one model needs.
          </p>
        </Card>
      ) : null}

      {agents.data?.agents.map((agent) => {
        const scoped = (agent.mcpServerIds as string[] | null) ?? [];
        return (
          <Card key={agent.id} className="gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{agent.name}</span>
                  <Badge variant="outline">
                    {agent.tasks.length === 1 ? "1 task" : `${agent.tasks.length} tasks`}
                  </Badge>
                  <Badge variant="outline">
                    {scoped.length
                      ? `${scoped.length} of ${servers.length} servers`
                      : "all servers"}
                  </Badge>
                </div>
                {agent.description ? (
                  <p className="truncate text-sm text-muted-foreground">{agent.description}</p>
                ) : null}
              </div>
              <Button variant="ghost" size="icon" onClick={() => setEditing(agent)}>
                <Pencil className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => remove.mutate(agent.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-1">
              {overrides(agent).length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  Overrides nothing — a task on it runs exactly as one on Settings.
                </span>
              ) : (
                overrides(agent).map((said) => (
                  <span
                    key={said}
                    className="rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground"
                  >
                    {said}
                  </span>
                ))
              )}
            </div>
          </Card>
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
    </Page>
  );
}
