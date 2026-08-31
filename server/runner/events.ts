/**
 * What a run is doing, while it is doing it.
 *
 * A run row only exists as a before and an after: it is written when the task starts and
 * updated when it stops, and everything in between — the thinking, the tool the model reached
 * for, the argument it got wrong — is gone by the time anyone can read it. This is that middle,
 * kept in memory and handed to whoever is watching.
 *
 * In memory on purpose: it is debugging output, worth nothing once the run has finished and its
 * outcome is in the database. Nothing here survives a restart, and nothing here is the record.
 */

/** How many events one run keeps for a watcher that joins late. A chatty run loses its oldest. */
const MAX_EVENTS = 1000;
/** How long a finished run stays readable, for a watcher that arrives just after the end. */
const RETAIN_MS = 60_000;

export type RunEventKind =
  /** A new turn of the agent loop began. */
  | "step"
  /** Reasoning tokens, as they arrive. */
  | "thinking"
  /** Reply tokens, as they arrive. */
  | "output"
  /** The model asked for a tool, with the arguments it chose. */
  | "tool-call"
  /** A tool came back, with what it said. */
  | "tool-result"
  /** Something the runner did that is not the model's doing — a preselection, a retry. */
  | "notice"
  /** The run ended. Always last, and always sent. */
  | "done";

export interface RunEvent {
  runId: string;
  /** Per-run counter, from 1. Lets a client order and de-duplicate what it receives. */
  seq: number;
  at: Date;
  kind: RunEventKind;
  /** The delta, the arguments, the result, or the reason — whatever the kind carries. */
  text: string;
  /** Tool name on the tool kinds, otherwise empty. */
  name: string;
  /** Outcome on `tool-result` and `done`, otherwise null. */
  ok: boolean | null;
}

/** What `emit` is given: the run and the sequence are the bus's to assign. */
export type RunEventInput = Pick<RunEvent, "kind"> & Partial<Omit<RunEvent, "kind">>;

interface Stream {
  events: RunEvent[];
  listeners: Set<(event: RunEvent) => void>;
  seq: number;
}

const streams = new Map<string, Stream>();

const streamFor = (runId: string): Stream => {
  const existing = streams.get(runId);
  if (existing) return existing;
  const stream: Stream = { events: [], listeners: new Set(), seq: 0 };
  streams.set(runId, stream);
  return stream;
};

/** Records one event and hands it to everyone watching that run. Never throws at the caller. */
export function emit(runId: string, input: RunEventInput): RunEvent {
  const stream = streamFor(runId);
  const event: RunEvent = {
    runId,
    seq: ++stream.seq,
    at: new Date(),
    text: "",
    name: "",
    ok: null,
    ...input,
  };
  stream.events.push(event);
  if (stream.events.length > MAX_EVENTS) stream.events.shift();
  for (const listener of stream.listeners) listener(event);

  if (event.kind === "done") {
    // Kept for a moment so a watcher that arrives just after the end still sees how it went,
    // then dropped: a finished run's record is the row, not this.
    setTimeout(() => {
      if (streams.get(runId) === stream && stream.listeners.size === 0) streams.delete(runId);
    }, RETAIN_MS).unref?.();
  }
  return event;
}

/**
 * Everything that has happened on a run, then everything that happens next, until it ends.
 *
 * The backlog comes first so a watcher that joins halfway through — or after the run finished,
 * inside the retention window — reads the same story as one that was there from the start.
 */
export async function* watch(runId: string): AsyncGenerator<RunEvent> {
  const stream = streamFor(runId);
  const queue: RunEvent[] = [...stream.events];
  let wake: (() => void) | null = null;
  const listener = (event: RunEvent) => {
    queue.push(event);
    wake?.();
  };
  stream.listeners.add(listener);
  try {
    for (;;) {
      while (queue.length > 0) {
        const event = queue.shift() as RunEvent;
        yield event;
        // `done` is the last event a run will ever have, so the subscription completes rather
        // than leaving the client holding an open stream that will never say anything again.
        if (event.kind === "done") return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  } finally {
    stream.listeners.delete(listener);
    // A watcher can name a run that has not started, or will never start. Nothing was recorded
    // under it, so nothing is left behind either.
    if (stream.listeners.size === 0 && stream.events.length === 0) streams.delete(runId);
  }
}

/** The backlog alone, for a caller that wants a snapshot rather than a subscription. */
export const history = (runId: string): RunEvent[] => [...(streams.get(runId)?.events ?? [])];

/** Test seam: forget every run, so one test's events cannot be read by the next. */
export const reset = () => streams.clear();
