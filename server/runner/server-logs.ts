import { type RunEventInput, RunEventKind } from "@cubicecho/agent-core";
import {
  isSerious,
  LOG_LEVELS,
  type LogLevel,
  MAX_STEP_SERVER_LOGS,
  type ServerLogNote,
} from "../../shared/server-logs.ts";

/**
 * Collects what a step's MCP servers complained about, as its run events go past, for
 * `run_steps.serverLogs`.
 *
 * Read off the events rather than taken from `onLog` in `agent.ts`, so that what is kept is what
 * the watcher was shown — the same tool name and the same preview of the message — and the one
 * place a log enters the run stays agent-core's `report.log`.
 */
export function serverLogCollector(cap = MAX_STEP_SERVER_LOGS) {
  const kept: ServerLogNote[] = [];
  let dropped = 0;
  let worst: LogLevel = "warning";

  return {
    /** Looks at one event and keeps it if it is a `server-log` at `warning` or worse. */
    observe(event: RunEventInput): void {
      if (event.kind !== RunEventKind.ServerLog || !event.level || !isSerious(event.level)) {
        return;
      }
      if (kept.length < cap) {
        kept.push({ tool: event.name ?? "", level: event.level, text: event.text ?? "" });
        return;
      }
      dropped++;
      if (LOG_LEVELS.indexOf(event.level as LogLevel) > LOG_LEVELS.indexOf(worst)) {
        worst = event.level as LogLevel;
      }
    },
    /** What the step keeps: the first `cap` entries, then one counting the rest. */
    entries(): ServerLogNote[] {
      if (dropped === 0) {
        return kept;
      }
      const more = `${dropped} more message${dropped === 1 ? "" : "s"} at warning or worse`;
      return [...kept, { tool: "", level: worst, text: `${more} not kept`, dropped }];
    },
  };
}
