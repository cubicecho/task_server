import { useEffect, useRef, useState } from "react";
import { RunEventsDocument, type RunEventsSubscription } from "@/gql/graphql";
import { subscribe } from "@/lib/gql";

type RunEvent = RunEventsSubscription["runEvents"];

/**
 * Consecutive tokens of the same kind are one thing being said, not hundreds of things.
 *
 * Folding them is what keeps this affordable: a reasoning model spends ten thousand tokens on a
 * one-line answer, and ten thousand list items — or ten thousand renders — is a locked-up tab.
 * Folded, that is one paragraph that grows, and the reasoning reads as prose besides.
 */
interface Block {
  seq: number;
  kind: string;
  name: string;
  ok?: boolean | null;
  text: string;
}

const mergeable = (kind: string) => kind === "thinking" || kind === "output";

function append(blocks: Block[], event: RunEvent): Block[] {
  const last = blocks[blocks.length - 1];
  if (last && mergeable(event.kind) && last.kind === event.kind) {
    return [...blocks.slice(0, -1), { ...last, text: last.text + event.text }];
  }
  return [
    ...blocks,
    { seq: event.seq, kind: event.kind, name: event.name, ok: event.ok, text: event.text },
  ];
}

/** Tokens arrive faster than anyone can read them; redraw on a human timescale instead. */
const FLUSH_MS = 100;

/**
 * A run as it happens: what the model is thinking, what it is writing, and which tools it is
 * reaching for — the middle of a run, which the row it leaves behind cannot show.
 *
 * The server replays the run from the beginning, so opening this halfway through a long run is
 * the same as having watched it from the start.
 */
export function RunStream({ runId }: { runId: string }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBlocks([]);
    setError("");
    setEnded(false);

    // A reconnect replays the run from the start, so the sequence is what says where we were.
    let seen = 0;
    let pending: RunEvent[] = [];
    const flush = () => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      setBlocks((prev) => batch.reduce(append, prev));
    };
    const timer = setInterval(flush, FLUSH_MS);

    const unsubscribe = subscribe(
      RunEventsDocument,
      { runId },
      {
        next: ({ runEvents: event }) => {
          if (event.seq <= seen) return;
          seen = event.seq;
          pending.push(event);
        },
        error: (failure) => setError(failure.message),
        complete: () => {
          flush();
          setEnded(true);
        },
      },
    );

    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [runId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: following new output is the point.
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [blocks]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={`size-2 rounded-full ${ended ? "bg-muted-foreground" : "animate-pulse bg-emerald-500"}`}
        />
        {ended ? "Run ended" : "Live"}
        {error ? <span className="text-destructive">· {error}</span> : null}
      </div>

      <div ref={scroller} className="max-h-80 overflow-y-auto rounded-md border bg-muted/30 p-3">
        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Waiting for the model…</p>
        ) : null}
        <div className="flex flex-col gap-2">
          {blocks.map((block) => (
            <BlockView key={`${block.kind}-${block.seq}`} block={block} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "thinking":
      return (
        <p className="whitespace-pre-wrap border-l-2 pl-2 text-sm text-muted-foreground italic">
          {block.text}
        </p>
      );
    case "output":
      return <p className="whitespace-pre-wrap text-sm">{block.text}</p>;
    case "tool-call":
      return (
        <p className="font-mono text-xs break-all text-muted-foreground">
          → {block.name}({block.text})
        </p>
      );
    case "tool-result":
      return (
        <p
          className={`font-mono text-xs whitespace-pre-wrap ${block.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          ← {block.name}: {block.text}
        </p>
      );
    case "step":
      return (
        <p className="border-t pt-2 text-xs tracking-wide text-muted-foreground uppercase">
          {block.text}
        </p>
      );
    default:
      // `notice` and `done`: the runner speaking rather than the model.
      return <p className="text-xs text-muted-foreground">{block.text}</p>;
  }
}
