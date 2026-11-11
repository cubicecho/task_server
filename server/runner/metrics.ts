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
 * Every step of a flow is a loop of its own, and their events concatenated are the whole account:
 * what `load_tools` resolved to rides on its results, and each turn carries the window its step's
 * model was served, so a flow whose steps run on models with different windows is measured
 * against each one rather than against a single figure for the run.
 */
export function metricsCollector() {
  const events: RunEvent[] = [];

  return {
    record(event: RunEvent): void {
      if (event.kind !== RunEventKind.Output && event.kind !== RunEventKind.Thinking) {
        events.push(event);
      }
    },

    /** The summary as it stands — called once the run's `done` has been recorded. */
    metrics(): RunMetrics {
      return runMetrics(events);
    },
  };
}
