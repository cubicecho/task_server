/**
 * How long ago `iso` was, as a word an operator can read at a glance.
 *
 * The MCP servers page shows it beside a connection: `status` reads `ready` either side of a
 * restart, so a server crash-looping every thirty seconds is indistinguishable from one that has
 * been up all week until something says when the connection started. "3m" answers that; the exact
 * timestamp is in the `title`, where it is there when the answer is "3m" for the fourth time.
 *
 * Coarse on purpose, and one unit only. This is read to notice that a number is small, not to
 * measure it, and "2d 4h 13m" is three numbers to compare against the last time you looked.
 *
 * @param iso When the connection became ready.
 * @param now Injected so the rounding boundaries are testable.
 * @returns A short duration, or null for a timestamp that cannot be read or has not happened —
 *   a clock skewed a few seconds the wrong way should show nothing rather than a negative age.
 */
export function uptime(iso: string, now: number = Date.now()): string | null {
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return null;

  const seconds = Math.floor((now - started) / 1000);
  if (seconds < 0) return null;
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}
