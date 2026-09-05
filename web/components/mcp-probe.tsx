import { CheckCircle2, XCircle } from "lucide-react";
import type { McpProbe } from "@/__generated__/graphql/graphql";
import { cn } from "@/lib/utils";

/**
 * What `testMcpServer` came back with.
 *
 * One copy, because there are two places to press Test — the row on the servers page and the
 * dialog that is editing one — and the answer is the same answer. The two had drifted already:
 * only one of them bolded the heading, and only one drew a red border around a failure.
 */
export function McpProbeResult({ probe, className }: { probe: McpProbe; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3 text-sm",
        !probe.ok && "border-destructive",
        className,
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        {probe.ok ? (
          <CheckCircle2 className="size-4" aria-hidden />
        ) : (
          <XCircle className="size-4 text-destructive" aria-hidden />
        )}
        {probe.ok ? `Connected — ${probe.tools.length} tool(s)` : "Could not connect"}
      </div>
      {probe.ok ? (
        <div className="flex flex-wrap gap-1">
          {probe.tools.map((tool) => (
            <span
              key={tool.name}
              title={tool.description}
              className="rounded-md border px-2 py-0.5 font-mono text-muted-foreground text-xs"
            >
              {tool.name}
            </span>
          ))}
        </div>
      ) : (
        <p className="whitespace-pre-wrap font-mono text-destructive text-xs">{probe.error}</p>
      )}
    </div>
  );
}
