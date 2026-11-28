import type { StatusLook } from "@/components/ui/status-badge";

/**
 * How a run's — or a run step's — status looks, in the one place both pages read it from.
 *
 * Four of the six are outlined rather than coloured, because only two of them are a verdict:
 * `ok` and `error`. `running` is not over, `queued` has not begun, `stopped` was called off,
 * and `skipped` never started — none of those went wrong, and none of them should read as
 * though they had. The word is the status as the server sends it.
 */
export const RUN_STATUSES = {
  error: { label: "error", variant: "destructive" },
  running: { label: "running", variant: "outline" },
  queued: { label: "queued", variant: "outline" },
  stopped: { label: "stopped", variant: "outline" },
  skipped: { label: "skipped", variant: "outline" },
  ok: { label: "ok", variant: "secondary" },
} as const satisfies Record<string, StatusLook>;
