/**
 * What an MCP server logged during a step's tool calls, as `run_steps.serverLogs` keeps it.
 *
 * In the one place both halves read it, for `shared/flow.ts`'s reason: the runner writes the
 * entries and the run page draws them, and the line between "worth keeping" and "debugging
 * chatter" is one rule rather than two that drift. Nothing in here may import anything, for the
 * same reason as `shared/flow.ts`.
 */

/**
 * The levels a row's `logLevel` may set, quietest first — MCP's, which are syslog's. The column's
 * enum is this list, so the API offers exactly what the pool accepts and nothing a server would
 * refuse.
 */
export const LOG_LEVELS = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Whether a level is a server complaining: `warning` and every level above it. The same line
 * agent-core's `runMetrics` draws for `serverWarnings` and `serverErrors`, so what the step keeps
 * is what the run's counts count. A level outside the spec's list is neither.
 */
export function isSerious(level: string): boolean {
  const rank = LOG_LEVELS.indexOf(level as LogLevel);
  return rank >= LOG_LEVELS.indexOf("warning");
}

/** Whether a level is `error` or worse, which the page draws in red rather than amber. */
export function isFailure(level: string): boolean {
  const rank = LOG_LEVELS.indexOf(level as LogLevel);
  return rank >= LOG_LEVELS.indexOf("error");
}

/**
 * The most entries one step keeps. A server that warns on every call of a fifty-call step is
 * saying one thing fifty times, and the run detail is read by a person looking for the first.
 * What the cap drops is counted on the last entry instead.
 */
export const MAX_STEP_SERVER_LOGS = 20;

/** One message a server logged at `warning` or worse while one of the step's calls ran. */
export interface ServerLogNote {
  /** The tool whose call it was logged during, as the model named it: `<slug>__<tool>`. */
  tool: string;
  /** The server's own word, one of `LOG_LEVELS` by the spec. */
  level: string;
  /** What it said — the data as a string, or as JSON — cut to the run event's preview. */
  text: string;
  /**
   * Set only on the entry that stands for what the cap dropped: how many more there were. Its
   * `level` is the worst among them and its `tool` is empty, since they may span several.
   */
  dropped?: number;
}
