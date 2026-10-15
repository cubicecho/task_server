import type { TestMcpServerMutation } from "@/__generated__/graphql/graphql";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CircleCheck } from "@/components/ui/icons";

/**
 * The probe as the document selects it. graphql-codegen 7 emits types for operations only, so
 * there is no schema-wide `McpProbe` to import, and this is the shape the two callers hold.
 */
export type McpProbe = TestMcpServerMutation["testMcpServer"];

/**
 * What `testMcpServer` came back with.
 *
 * One copy, because there are two places to press Test — the row on the servers page and the
 * dialog that is editing one — and the answer is the same answer. The two had drifted already:
 * only one of them bolded the heading, and only one drew a red border around a failure.
 */
export function McpProbeResult({ probe, className }: { probe: McpProbe; className?: string }) {
  if (!probe.ok) {
    return (
      <Alert
        variant="destructive"
        title="Could not connect"
        description={<span className="whitespace-pre-wrap font-mono text-xs">{probe.error}</span>}
        className={className}
      />
    );
  }
  return (
    <Alert
      iconSlot={<CircleCheck />}
      title={`Connected — ${probe.tools.length} tool(s)`}
      description={
        <span className="flex flex-wrap gap-1 pt-1">
          {probe.tools.map((tool) => (
            <Badge
              key={tool.name}
              title={tool.description}
              variant="outline"
              className="font-mono font-normal"
            >
              {tool.name}
            </Badge>
          ))}
        </span>
      }
      className={className}
    />
  );
}
