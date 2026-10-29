import { type RunEvent, RunEventKind, type RunMetrics, runMetrics } from "@cubicecho/agent-core";

/**
 * A run's events, kept by the run itself for `runMetrics` once it ends.
 *
 * Not read back off the bus: it keeps a thousand events per run and drops the oldest, and a
 * reasoning model spends that on one paragraph's tokens — the tool calls and turn reports a
 * summary is made of would be long gone by the end of a run worth summarising. The token deltas
 * are what fills it, and `runMetrics` reads none of them, so they are not kept here either; what
 * is left is a few events per turn and per tool call.
 *
 * Two things the events do not carry come from each step's loop instead. What `load_tools`
 * resolved to is summed over the steps. And the window: each step's loop is told its own model's,
 * and a flow may put steps on models with different ones, so the run's largest prompt over any
 * single window can misstate how close it came. Where every step was served the same window that
 * is what `runMetrics` is given; either way the share kept is the highest any step measured.
 */
export function metricsCollector() {
  const events: RunEvent[] = [];
  let loads: Pick<RunMetrics, "toolsLoaded" | "redundantLoads" | "unknownToolNames"> = {};
  const windows = new Set<number>();
  let share: number | undefined;

  return {
    record(event: RunEvent): void {
      if (event.kind !== RunEventKind.Output && event.kind !== RunEventKind.Thinking) {
        events.push(event);
      }
    },

    step(metrics: RunMetrics, contextLength: number): void {
      const sum = (a?: number, b?: number) =>
        a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
      loads = {
        toolsLoaded: sum(loads.toolsLoaded, metrics.toolsLoaded),
        redundantLoads: sum(loads.redundantLoads, metrics.redundantLoads),
        unknownToolNames: sum(loads.unknownToolNames, metrics.unknownToolNames),
      };
      if (contextLength > 0) {
        windows.add(contextLength);
      }
      if (metrics.largestPromptShare !== undefined) {
        share = Math.max(share ?? 0, metrics.largestPromptShare);
      }
    },

    /** The summary as it stands — called once the run's `done` has been recorded. */
    metrics(): RunMetrics {
      const [window] = windows;
      const summary = runMetrics(events, {
        contextLength: windows.size === 1 ? window : undefined,
      });
      if (share !== undefined) {
        summary.largestPromptShare = share;
      }
      for (const [key, value] of Object.entries(loads)) {
        if (value !== undefined) {
          summary[key as keyof typeof loads] = value;
        }
      }
      return summary;
    },
  };
}
