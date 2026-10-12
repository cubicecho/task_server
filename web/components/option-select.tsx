import type { ComponentProps, ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  Select as SelectRoot,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectOption = {
  label: ReactNode;
  value: string;
  /**
   * The heading this option is drawn under. Options sharing one are drawn together beneath it,
   * in the order they were given rather than sorted — a board's lanes are ordered, and
   * alphabetical would be wrong.
   */
  group?: string;
  /**
   * The row's class, on the item itself. For values that are identifiers rather than prose — a
   * model id is `font-mono` — where a span around the label would leave the tick and the
   * highlight in the body face.
   */
  className?: string;
};

/** A rule across the list. The one entry that is not an option, so it has no `value`. */
export type SelectSeparatorEntry = { separator: true };

/**
 * A row that is not a choice: "Loading…", or why the list could not be fetched.
 *
 * Not a disabled option, which is the row every hand-written version reaches for and which the
 * keyboard walks onto and a reader hears as a choice they may not have. The row is hidden from
 * assistive technology and its words are announced from a status region beside the trigger —
 * the case exactly, since a menu that fills when it opens is open before its list exists.
 */
export type SelectNoteEntry = { note: ReactNode; className?: string };

/**
 * What `options` holds: the options, the rules between them, and the notes among them.
 *
 * A list of peers is still a list of peers — nothing here is written until an option is not one.
 * The case that asked for it: a picker answering "where does this card go when it passes" with
 * *stay here*, then the other lanes, then *archive it*, which is not a lane at all. Without a
 * rule the last row sits flush against the lane names and reads as one of them, and the
 * workaround is a sentence doing a divider's job — `"Archive it — off the board"`.
 */
export type SelectEntry = SelectOption | SelectSeparatorEntry | SelectNoteEntry;

/** Generic over the entry, so the same test sorts a raw list and the blocks built from one. */
function isSeparator<T extends object>(entry: T): entry is T & SelectSeparatorEntry {
  return "separator" in entry;
}

function isNote<T extends object>(entry: T): entry is T & SelectNoteEntry {
  return "note" in entry;
}

type SelectBlock =
  | SelectSeparatorEntry
  | SelectNoteEntry
  | { group?: string; options: SelectOption[] };

/**
 * The flat list, as the runs Radix draws: a rule is its own block, and consecutive options
 * sharing a `group` are one.
 *
 * Walked rather than bucketed, because the order is the caller's and a group that reappears
 * later is a caller who meant it. Options with no `group` are a block with no heading, which is
 * every list that has not asked for one.
 */
function blocksOf(entries: readonly SelectEntry[]): SelectBlock[] {
  const blocks: SelectBlock[] = [];
  for (const entry of entries) {
    if (isSeparator(entry) || isNote(entry)) {
      blocks.push(entry);
      continue;
    }
    const last = blocks.at(-1);
    if (last && !isSeparator(last) && !isNote(last) && last.group === entry.group) {
      last.options.push(entry);
    } else {
      blocks.push({ group: entry.group, options: [entry] });
    }
  }
  return blocks;
}

type OptionSelectProps = Omit<
  ComponentProps<"button">,
  "value" | "onChange" | "type" | "children"
> & {
  options: readonly SelectEntry[];
  value?: string;
  onValueChange: (value: string) => void;
  /** What the trigger says with nothing chosen. */
  placeholder?: string;
  /** The dropdown's class. `className` still goes to the trigger, which is the control. */
  contentClassName?: string;
  /**
   * Whether the menu is open, to drive it. The root's rather than the trigger's, which is why
   * it is a prop here and not something spread with the rest.
   */
  open?: boolean;
  /**
   * Told when the menu opens and closes. Passed alone it only listens, which is what a list
   * fetched on first open wants: a form of twenty fields should not ask for eighteen lists
   * nobody looks at.
   */
  onOpenChange?: (open: boolean) => void;
};

/**
 * A select taking a list of options, rather than seven primitives to assemble.
 *
 * The other four pickers in this set ship twice — a control taking `value` and `onValueChange`,
 * and a bound field wrapping it. Select shipped once, as `SelectField`, so the only way to get
 * one was through a TanStack form: a filter bar, a search box or a `useState` screen had to
 * hand-write the trigger, the value, the content and the mapped items, and there are ten of
 * those across these projects.
 *
 * They are hand-written wrong in the same place every time. **Radix's `Select` root renders no
 * DOM**, so an `id` or an `aria-invalid` put on it goes nowhere; both belong on the trigger.
 * Which is why this takes the rest of a `<button>`'s props and spreads them there — the shape
 * `FormField`'s function form hands its control, so this drops into one without a wrapper:
 *
 * ```tsx
 * <FormField
 *   label="Kind"
 *   control={(wired) => (
 *     <OptionSelect {...wired} options={KINDS} value={kind} onValueChange={setKind} />
 *   )}
 * />
 * ```
 *
 * **The name is `OptionSelect` because `Select` did not survive an install.** This shipped as
 * `Select`, on the reasoning that the import path tells it apart from the primitive at
 * `ui/select` the way it does for shadcn itself. It does not: the shadcn CLI resolves a
 * cross-item import by the source file's *basename*, so with `control/select.tsx` and
 * `ui/select.tsx` both in one install it rewrote `app-form`'s import to the primitive. That
 * compiles as far as the import and fails on the members, three files from the cause — see #36.
 * A name a human disambiguates by path is not one the CLI does, so no item here may share a
 * basename with a shadcn primitive.
 */
export function OptionSelect({
  options,
  value,
  onValueChange,
  placeholder,
  className,
  contentClassName,
  disabled,
  open,
  onOpenChange,
  ...props
}: OptionSelectProps) {
  const blocks = useMemo(() => blocksOf(options), [options]);
  // Kept even when the caller only listens, because the notes are read out while the menu is
  // open and at no other time.
  const [listening, setListening] = useState(false);
  const shown = open ?? listening;
  const notes = options.filter(isNote);

  return (
    <SelectRoot
      value={value ?? ""}
      onValueChange={onValueChange}
      disabled={disabled}
      open={open}
      onOpenChange={(next) => {
        setListening(next);
        onOpenChange?.(next);
      }}
    >
      {/* Full width by default, because a select in a field is one and a trigger that shrinks to
          its longest option makes a column of them ragged. `cn` lets a caller say otherwise. */}
      <SelectTrigger {...props} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {/* Always mounted, and outside the menu: a live region that arrives with its words already
          in it is not announced, and one inside the listbox would be a row. */}
      <span className="sr-only" role="status" aria-live="polite">
        {shown
          ? notes.map((entry, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a note has no identity of its own
              <span key={`note-${index}`}>{entry.note} </span>
            ))
          : null}
      </span>
      <SelectContent className={contentClassName}>
        {/*
          Keyed by position, and it has to be: a rule has no identity of its own, and a heading
          that appears twice is a caller who meant it, so neither is unique. The list is the
          caller's and is drawn in the order given, so a position is stable enough.
        */}
        {blocks.map((block, index) =>
          isSeparator(block) ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: a rule has no identity of its own
            <SelectSeparator key={`block-${index}`} />
          ) : isNote(block) ? (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: nor does a note
              key={`block-${index}`}
              aria-hidden
              className={cn("px-2 py-1.5 text-muted-foreground text-sm", block.className)}
            >
              {block.note}
            </div>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: nor does a repeated heading
            <SelectGroup key={`block-${index}`}>
              {block.group ? <SelectLabel>{block.group}</SelectLabel> : null}
              {block.options.map((option) => (
                <SelectItem key={option.value} value={option.value} className={option.className}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ),
        )}
      </SelectContent>
    </SelectRoot>
  );
}
