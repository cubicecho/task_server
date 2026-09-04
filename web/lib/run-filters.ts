import type { RunFilters, RunsStatusEnum } from "@/__generated__/graphql/graphql";

/**
 * What the runs page is asking for, as the `where` the server is asked it in.
 *
 * Its own file rather than a helper inside the route, so that `tests/run-history.test.ts` can
 * put the filter this builds against a real database. The interesting half is not the shape —
 * it is that `ilike` with an escaped term, an enum `eq`, a timestamp `gte` and an `OR` across a
 * relation all mean, in postgres, what the controls above the list say they mean. That is a
 * question about SQL, and nothing in the browser can answer it.
 */

export const ANY = "any";

/**
 * How far back the list looks, anchored to the moment it is chosen.
 *
 * A window computed at each render slides: "last hour" quietly drops the run you were reading
 * about, and the filter changes identity every render, which is a refetch on a loop. Fixing the
 * cutoff when the option is picked makes the page stand still, and Refresh is how you move it.
 */
export const WINDOWS = [
  { value: ANY, label: "Any time", ms: 0 },
  { value: "hour", label: "Last hour", ms: 3_600_000 },
  { value: "day", label: "Last 24 hours", ms: 86_400_000 },
  { value: "week", label: "Last 7 days", ms: 604_800_000 },
  { value: "month", label: "Last 30 days", ms: 2_592_000_000 },
] as const;

export type Filters = {
  search: string;
  status: string;
  taskId: string;
  window: string;
  /** The cutoff `window` resolved to when it was chosen; null for "any time". */
  from: string | null;
};

export const NO_FILTERS: Filters = {
  search: "",
  status: ANY,
  taskId: ANY,
  window: ANY,
  from: null,
};

/** Whether any control is set — which is both what to offer a Clear button for and what to
 * stop polling behind. */
export const isFiltered = (filters: Filters) =>
  filters.search !== "" ||
  filters.status !== ANY ||
  filters.taskId !== ANY ||
  filters.window !== ANY;

/**
 * The controls as one `where`, or nothing at all when none of them are set.
 *
 * Everything ANDs except the search box, which is one OR across the two columns a run's text
 * lives in and the name of the task that produced it — the three places the thing you half
 * remember could have been written. `%` and `_` are escaped because a search for a rate limit
 * ("100%") is not a wildcard, and postgres reads a bare one as "anything at all".
 */
export function buildWhere(filters: Filters, search: string): RunFilters | undefined {
  const and: RunFilters[] = [];

  if (filters.taskId !== ANY) and.push({ taskId: { eq: filters.taskId } });
  if (filters.status !== ANY) and.push({ status: { eq: filters.status as RunsStatusEnum } });
  if (filters.from) and.push({ startedAt: { gte: filters.from } });

  const term = search.trim();
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    and.push({
      OR: [
        { output: { ilike: like } },
        { error: { ilike: like } },
        { task: { name: { ilike: like } } },
      ],
    });
  }

  return and.length ? { AND: and } : undefined;
}
