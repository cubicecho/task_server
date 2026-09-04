/**
 * How a run's — or a run step's — status looks, in the one place both pages read it from.
 *
 * Three of the five are outlined rather than coloured, because only two of them are a verdict:
 * `ok` and `error`. `running` is not over, `stopped` was called off, and `skipped` never
 * started — none of those went wrong, and none of them should read as though they had.
 */
export const STATUS_VARIANT: Record<string, "destructive" | "outline" | "secondary"> = {
  error: "destructive",
  running: "outline",
  stopped: "outline",
  skipped: "outline",
  ok: "secondary",
};
