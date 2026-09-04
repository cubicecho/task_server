import { memo, useEffect, useMemo, useRef, useState } from "react";
import { RunEventsDocument, type RunEventsSubscription } from "@/__generated__/graphql/graphql";
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
  /** The flow step this was said in. Empty for what the runner says about the run itself. */
  step: string;
  ok?: boolean | null;
  text: string;
}

const mergeable = (kind: string) => kind === "thinking" || kind === "output";

/**
 * Folds one event into a list the caller already owns, in place.
 *
 * A batch is a hundred tokens at the far end of a run that is already thousands of blocks long,
 * and copying the whole list per token is quadratic in exactly the case this component exists
 * for. The list is copied once per batch instead, and every event of that batch is written into
 * it. The blocks themselves are still replaced rather than edited, so a memoised `BlockView`
 * redraws the one that grew and none of the ones that did not.
 */
function appendInto(blocks: Block[], event: RunEvent) {
  const last = blocks[blocks.length - 1];
  // Never across a step boundary: two steps writing the same kind of thing are two answers.
  if (last && mergeable(event.kind) && last.kind === event.kind && last.step === event.step) {
    blocks[blocks.length - 1] = { ...last, text: last.text + event.text };
    return;
  }
  blocks.push({
    seq: event.seq,
    kind: event.kind,
    name: event.name,
    step: event.step,
    ok: event.ok,
    text: event.text,
  });
}

/** One flow step's worth of blocks, under the name of the step that produced them. */
interface Group {
  step: string;
  kind: string;
  blocks: Block[];
}

function group(blocks: Block[]): Group[] {
  const groups: Group[] = [];
  for (const block of blocks) {
    let last = groups[groups.length - 1];
    if (!last || last.step !== block.step) {
      last = { step: block.step, kind: "", blocks: [] };
      groups.push(last);
    }
    // The `step` event is the heading rather than a line of its own; it names the kind.
    if (block.kind === "step") last.kind = block.text;
    else last.blocks.push(block);
  }
  return groups;
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
    /** Whether the message on screen is about a connection that has since come back. */
    let failed = false;
    let pending: RunEvent[] = [];
    const flush = () => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      setBlocks((prev) => {
        const next = prev.slice();
        for (const event of batch) appendInto(next, event);
        return next;
      });
    };
    const timer = setInterval(flush, FLUSH_MS);

    const unsubscribe = subscribe(
      RunEventsDocument,
      { runId },
      {
        next: ({ runEvents: event }) => {
          if (event.seq <= seen) return;
          seen = event.seq;
          // The transport resubscribes on its own, so a dropped connection is usually followed
          // by events again — and "lost the connection to the server" stayed on screen for the
          // rest of a run that had already recovered. Guarded by the flag rather than cleared
          // per event: this runs once per token.
          if (failed) {
            failed = false;
            setError("");
          }
          pending.push(event);
        },
        error: (failure) => {
          failed = true;
          setError(failure.message);
        },
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

  // Regrouping is cheap per block and ruinous per keystroke of output: without this it runs
  // again for the scroll effect, the ended flag, and every other render this component has.
  const groups = useMemo(() => group(blocks), [blocks]);

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
        <div className="flex flex-col gap-3">
          {groups.map((entry, index) => (
            <section
              // Two steps can share a name across arms, so position is what tells them apart.
              // biome-ignore lint/suspicious/noArrayIndexKey: groups only ever grow at the end
              key={index}
              className="flex flex-col gap-2"
            >
              {entry.step ? (
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {entry.step}
                  {entry.kind === "decision" ? " · decision" : ""}
                </p>
              ) : null}
              {entry.blocks.map((block) => (
                <BlockView key={`${block.kind}-${block.seq}`} block={block} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Memoised: a token arriving grows the last block and leaves every earlier one identical, so
 * a run that has said ten thousand things redraws one paragraph rather than all of them.
 */
const BlockView = memo(function BlockView({ block }: { block: Block }) {
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
    case "turn":
      return (
        <p className="border-t pt-2 text-xs tracking-wide text-muted-foreground uppercase">
          {block.text}
        </p>
      );
    case "decision":
      // The arm it chose — the one thing you open a branching run to find out.
      return <p className="text-sm font-medium">&rarr; {block.text}</p>;
    default:
      // `notice` and `done`: the runner speaking rather than the model.
      return <p className="text-xs text-muted-foreground">{block.text}</p>;
  }
});
