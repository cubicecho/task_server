/**
 * How a run's — or a run step's — status looks, in the one place both pages read it from.
 *
 * Four of the six are outlined rather than coloured, because only two of them are a verdict:
 * `ok` and `error`. `running` is not over, `queued` has not begun, `stopped` was called off,
 * and `skipped` never started — none of those went wrong, and none of them should read as
 * though they had.
 */
export const STATUS_VARIANT: Record<string, "destructive" | "outline" | "secondary"> = {
  error: "destructive",
  running: "outline",
  queued: "outline",
  stopped: "outline",
  skipped: "outline",
  ok: "secondary",
};
