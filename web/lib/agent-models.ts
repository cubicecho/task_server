import { useQuery } from "@tanstack/react-query";
import { AgentModelsDocument } from "@/__generated__/graphql/graphql";
import { request } from "@/lib/gql";

const NONE: ReadonlySet<string> = new Set();

/**
 * Which models an endpoint lists as ai-router agents: the server's own, or an agent profile's.
 *
 * One query key per endpoint, shared by the model picker that marks them and the profile form
 * that leaves out what such an agent does for itself, so the two cannot disagree about a model.
 *
 * @param agentId The profile whose endpoint to ask; omitted, the server's own.
 * @param enabled Whether to ask yet. The router is a live call that may not be running.
 */
export function useAgentModels(agentId?: string, enabled = true): ReadonlySet<string> {
  const query = useQuery({
    queryKey: ["agent-models", agentId ?? ""],
    queryFn: () => request(AgentModelsDocument, { agentId }),
    enabled,
    retry: false,
    staleTime: 60_000,
    select: (data) => new Set(data.agentModels),
  });
  return query.data ?? NONE;
}
