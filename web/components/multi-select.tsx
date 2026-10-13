import type { ComponentProps, ReactNode } from "react";
import { useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/ui/color-dot";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { matchesEveryWord } from "@/components/ui/command-base";
import { Check, ChevronsUpDown, Plus, X } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { readableTextColor } from "@/lib/readable-text-color";
import { cn } from "@/lib/utils";

/** One choice in a `MultiSelect`. */
export type MultiSelectOption = {
  value: string;
  /** What is read, searched and shown on the chip. A string, because all three need one. */
  label: string;
  /** Extra words the search should match — a synonym, an old name, a code. */
  keywords?: string[] | undefined;
  /** A CSS colour for the chip. The text on it is chosen for contrast, not hardcoded. */
  color?: string | undefined;
  disabled?: boolean | undefined;
  /**
   * The end of the row: a status badge, a count, a date. Drawn beside the label, never on the
   * chip — the chip is a string and stays one.
   *
   * A description rather than a name, so a row still announces as what it is called and the
   * badge is read after it. `color` cannot do this job: it is the chip's colour, and pointing it
   * at a status would mint a second colour vocabulary beside the app's own.
   */
  meta?: ReactNode | undefined;
  /**
   * The heading these options are drawn under. Options sharing one are drawn together beneath
   * it, in the order they were given rather than sorted — a board's lanes are ordered, and
   * alphabetical would be wrong.
   *
   * The heading is also searched, so typing a lane's name still finds the cards in it. A heading
   * whose options are all filtered out hides itself, on both halves, which is what you want.
   */
  group?: string | undefined;
  /**
   * Why this option is the way it is — most often why it is unavailable.
   *
   * Drawn under the label and read after it, so it survives the case it is for: a `disabled` row
   * fires no hover, so a tooltip on it is text nobody can reach, and "greyed out" on its own
   * reads as a bug in the picker rather than as a decision. The reason is knowable when the
   * options are built and unreachable by the time somebody wonders — this is the one place to
   * put it.
   *
   * Same argument as {@link Button}'s `hint`, in a control that had not had it yet.
   */
  hint?: ReactNode | undefined;
};

/**
 * The options to draw, with one synthesised for every selected value nothing covers.
 *
 * A row loaded from the server holds ids; the options come from a query that may not have
 * finished, may be paged, or may simply no longer contain a tag someone deleted. Without this
 * the chip for that value is not drawn at all — so it is invisible, still submitted, and
 * unremovable, which is the "why is this tag stuck on it" bug in two of these apps.
 */
export function mergeMultiSelectOptions(
  options: readonly MultiSelectOption[],
  value: readonly string[],
): MultiSelectOption[] {
  const known = new Set(options.map((option) => option.value));
  const orphans = value.filter((selected) => known.has(selected) === false);
  return orphans.length === 0
    ? [...options]
    : [...options, ...orphans.map((selected) => ({ value: selected, label: selected }))];
}

type MultiSelectRun = { group?: string | undefined; options: MultiSelectOption[] };

/**
 * The flat list as the runs it is drawn in: consecutive options sharing a `group` are one.
 *
 * Walked rather than bucketed, because the order is the caller's — a board's lanes are ordered —
 * and a heading that reappears later is a caller who meant it. Options with no `group` are a run
 * with no heading, which is every list that has not asked for one, including the values
 * {@link mergeMultiSelectOptions} synthesised.
 */
function groupsOf(options: readonly MultiSelectOption[]): MultiSelectRun[] {
  const runs: MultiSelectRun[] = [];
  for (const option of options) {
    const last = runs.at(-1);
    if (last && last.group === option.group) {
      last.options.push(option);
    } else {
      runs.push({ group: option.group, options: [option] });
    }
  }
  return runs;
}

/**
 * Whether a typed name is worth offering to create.
 *
 * Exact match only, ignoring case and surrounding space. Not a substring test: "Work" must stay
 * addable while "Workshop" exists, and a `.includes` here is the reason one of these apps cannot
 * create a tag whose name is a prefix of another.
 */
export function isAddableOptionName(name: string, options: readonly MultiSelectOption[]): boolean {
  const trimmed = name.trim();
  if (trimmed === "") {
    return false;
  }
  const folded = trimmed.toLocaleLowerCase();
  return options.every((option) => option.label.trim().toLocaleLowerCase() !== folded);
}

/**
 * The two colour props a tag-coloured chip needs, as a spread.
 *
 * `Badge` takes them as props rather than as a `style`, because the same component
 * renders a `<Text>` on native and there is no inheritance to carry the label colour
 * down to it.
 */
function chipColors(color: string | undefined) {
  if (!color) {
    return {};
  }
  return { backgroundColor: color, textColor: readableTextColor(color) };
}

/** Off the screen and still read. `sr-only` is a clip, which the device does not have. */
const SR_ONLY = "sr-only";

type MultiSelectProps = Omit<
  ComponentProps<typeof Button>,
  "value" | "onChange" | "type" | "children" | "variant" | "size" | "asChild" | "onPress"
> & {
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  /** What the trigger says with nothing selected. */
  placeholder?: string | undefined;
  searchPlaceholder?: string | undefined;
  /**
   * The search box's accessible name. cmdk points its input at a hidden `<label>` it renders
   * from `Command`'s `label`, and the native half makes it the input's `aria-label`, so without
   * this the search box has no name at all — a placeholder is not one.
   */
  searchLabel?: string | undefined;
  /**
   * What the popover is called. On the web it is a `role="dialog"`, and a dialog needs a name.
   *
   * The name is rendered inside it rather than borrowed from the trigger with
   * `aria-labelledby`: a label that lives outside the dialog resolves to nothing the moment the
   * thing it points at is hidden, removed or re-keyed, and then the failure is a silent one that
   * only an axe run catches. On device it is the first thing a screen reader reads in the sheet.
   */
  popoverLabel?: string | undefined;
  /** What the list says when the search matches nothing and there is nothing to add. */
  emptyMessage?: string | undefined;
  /** Off, the list has no search box — for the six-option case where it is only in the way. */
  searchable?: boolean | undefined;
  /**
   * Offer to create what was typed. The handler owns the creation *and* the selection: it is
   * usually a mutation, and only the caller knows the id the new row came back with.
   */
  onCreateOption?: ((name: string) => void) | undefined;
  /** What the create row says, before the quoted name. */
  createLabel?: string | undefined;
  /** Chips to draw before collapsing to a count. `0` always shows the count. */
  maxDisplay?: number | undefined;
  clearable?: boolean | undefined;
  contentClassName?: string | undefined;
};

/**
 * One line of an option that is not its name — the hint under it or the meta at its end — with
 * the id the row's `aria-describedby` points at. A string gets its own `Text`, since colour does
 * not inherit on native; anything else (a `Badge`) is placed as it is, in a box carrying the id.
 */
function OptionLine({
  id,
  slot,
  className,
  children,
}: {
  id: string | undefined;
  slot: string;
  className: string;
  children: ReactNode;
}) {
  if (typeof children === "string" || typeof children === "number") {
    return (
      <span
        id={id}
        data-slot={slot}
        className={cn("cube-rn-text", "text-xs text-foreground/60", className)}
      >
        {children}
      </span>
    );
  }
  return (
    <div id={id} data-slot={slot} className={cn("cube-rn-view", className)}>
      {children}
    </div>
  );
}

/**
 * The muted lines answering the highlight. cmdk paints the highlighted row `bg-hover`, and muted
 * text on it is 4.34:1 — under the 4.5 a body-size string needs, so whichever row the arrow keys
 * are on is the one that cannot be read. There is no highlight on device.
 */
const ON_HIGHLIGHT = "group-data-[selected=true]:text-foreground";

/**
 * One option, which is up to four things: the tick, the colour dot, what it is called, and what
 * else is true of it.
 *
 * Its own component because the rows are drawn inside a run rather than in one flat map, and
 * because everything about the row that is not the label is a *description* — which takes two
 * ids, an explicit name, and a layout that changes when there is a second line. That is more
 * than belongs in a nested map.
 */
function OptionRow({
  option,
  idPrefix,
  selected,
  onToggle,
}: {
  option: MultiSelectOption;
  idPrefix: string;
  selected: boolean;
  onToggle: (value: string) => void;
}) {
  const hintId = option.hint ? `${idPrefix}-hint-${option.value}` : undefined;
  const metaId = option.meta ? `${idPrefix}-meta-${option.value}` : undefined;
  // A second line changes the row from centred to top-aligned, and everything on the first line
  // has to be nudged down to sit on it.
  const stacked = Boolean(option.hint);

  return (
    <CommandItem
      // What the filter sees. `value` alone would search ids, which nobody types; the heading is
      // in here so that typing a lane's name still finds the cards in it.
      value={[option.label, option.group, ...(option.keywords ?? [])].filter(Boolean).join(" ")}
      {...(option.disabled === undefined ? {} : { disabled: option.disabled })}
      // `aria-checked`, not `aria-selected`, and not by preference: cmdk uses
      // `aria-selected` for which option is *highlighted* and sets it after the
      // props it is given, so it cannot also carry which options are chosen.
      // `aria-checked` is valid on `role="option"`, is the one cmdk leaves alone,
      // and is read as "checked" — which is what the tick beside it means. Without
      // it the selection is a visual mark and nothing else, which is what every
      // version of this in these projects ships.
      aria-checked={selected}
      // The name is the label and nothing else. Without this the badge and the hint would be
      // swept into the accessible name by the contents, so the row would announce them as part
      // of what it is called, and again as its description — twice, in the wrong order, as one
      // sentence.
      aria-label={option.label}
      // In reading order: the end of the row, then the line under it.
      aria-describedby={[metaId, hintId].filter(Boolean).join(" ") || undefined}
      onSelect={() => onToggle(option.value)}
      // `group` so the two muted lines can answer the highlight — see `ON_HIGHLIGHT`.
      className={cn("group", stacked && "items-start")}
    >
      <Check
        className={cn(
          "size-4 shrink-0",
          stacked && "mt-0.5",
          selected ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
      {option.color ? (
        <ColorDot color={option.color} size="sm" className={cn(stacked && "mt-1.5")} />
      ) : null}
      <div className="cube-rn-view min-w-0 flex-1">
        <span className="cube-rn-text truncate text-sm text-foreground">{option.label}</span>
        {option.hint ? (
          // Wrapped rather than truncated: a reason cut off at the edge of the
          // popover is the same as no reason.
          <OptionLine id={hintId} slot="multi-select-option-hint" className={ON_HIGHLIGHT}>
            {option.hint}
          </OptionLine>
        ) : null}
      </div>
      {option.meta ? (
        <OptionLine
          id={metaId}
          slot="multi-select-option-meta"
          className={cn("shrink-0", ON_HIGHLIGHT, stacked && "mt-0.5")}
        >
          {option.meta}
        </OptionLine>
      ) : null}
    </CommandItem>
  );
}

/**
 * A combobox that selects more than one thing: a `Popover` over a `Command` on both halves. On
 * the web that is radix over cmdk, which owns the keyboard; on device it is a centred sheet whose
 * rows are pressed.
 *
 * Clearing is in the footer and not on the trigger, because the trigger is a `<button>` and a
 * button inside a button is invalid and unreachable by keyboard. On device each chip is also a
 * removable `Badge`, since a `Pressable` inside a `Pressable` takes the touch.
 */
export function MultiSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  searchLabel = "Search",
  popoverLabel = "Options",
  emptyMessage = "No matches.",
  searchable = true,
  onCreateOption,
  createLabel = "Add",
  maxDisplay = 3,
  clearable = true,
  className,
  contentClassName,
  disabled,
  id,
  ...props
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const generatedId = useId();
  const titleId = useId();
  const rowId = useId();
  // The trigger needs a stable id whether or not a field shell gave it one, because the popover
  // is named by pointing at it — a Radix popover is `role="dialog"`, and an unnamed dialog is an
  // accessibility failure that only shows up once something opens it.
  const triggerId = id ?? generatedId;

  const merged = useMemo(() => mergeMultiSelectOptions(options, value), [options, value]);
  const runs = useMemo(() => groupsOf(merged), [merged]);
  const selected = useMemo(
    () => value.map((v) => merged.find((option) => option.value === v)).filter(Boolean),
    [merged, value],
  ) as MultiSelectOption[];

  const canCreate = Boolean(onCreateOption) && isAddableOptionName(search, merged);

  const toggle = (option: string) => {
    onValueChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  };

  const shown = maxDisplay > 0 ? selected.slice(0, maxDisplay) : [];
  const overflow = selected.length - shown.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          data-slot="multi-select-trigger"
          id={triggerId}
          variant="outline"
          role="combobox"
          // `aria-controls` and `aria-haspopup` are Radix's, through `asChild`, and point at the
          // popover it owns. cmdk mints the listbox id itself and overwrites any id passed to
          // `CommandList`, so there is nothing here that could point at it honestly.
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-auto min-h-9 w-full justify-between gap-2 bg-transparent px-3 py-1.5 font-normal",
            "whitespace-normal shadow-xs aria-invalid:border-negative aria-invalid:ring-negative/40 disabled:cursor-not-allowed",
            className,
          )}
          {...props}
          content={
            <div className="cube-rn-view min-w-0 flex-1 flex-row flex-wrap items-center gap-1">
              {selected.length === 0 ? (
                <span className="cube-rn-text text-sm text-foreground/60">{placeholder}</span>
              ) : (
                <>
                  {shown.map((option) => (
                    <Badge
                      key={option.value}
                      variant="secondary"
                      {...chipColors(option.color)}
                      className={"max-w-40 truncate"}
                      // Device only: on the web this would be a button inside the trigger's button.
                    >
                      {option.label}
                    </Badge>
                  ))}
                  {overflow > 0 ? (
                    <span className="cube-rn-text text-xs text-foreground/60">
                      {shown.length === 0 ? `${overflow} selected` : `+${overflow}`}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          }
          trailingSlot={<ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />}
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        // radix names its dialog from this; the native sheet has no dialog role to name, and the
        // title below is simply the first thing read in it.
        aria-labelledby={titleId}
        className={cn("w-[var(--radix-popover-trigger-width)] p-0", contentClassName)}
      >
        <span id={titleId} className={cn("cube-rn-text", SR_ONLY, "text-foreground")}>
          {popoverLabel}
        </span>
        <Command label={searchLabel} filter={matchesEveryWord} shouldFilter={searchable}>
          {searchable ? (
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={searchPlaceholder}
            />
          ) : null}
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {runs.map((run, index) => (
              // Positional, because a heading that appears twice is a caller who meant it and so
              // is not unique. The list is the caller's and is drawn in the order given.
              // biome-ignore lint/suspicious/noArrayIndexKey: a run has no id of its own
              <CommandGroup key={`run-${index}`} heading={run.group}>
                {run.options.map((option) => (
                  <OptionRow
                    key={option.value}
                    option={option}
                    idPrefix={rowId}
                    selected={value.includes(option.value)}
                    onToggle={toggle}
                  />
                ))}
              </CommandGroup>
            ))}

            {canCreate ? (
              // An explicit row, not an Enter handler on the input: cmdk already consumes Enter
              // to choose the highlighted item, so a keydown listener races it and wins only
              // sometimes. A row is a thing you can see, arrow to, and press.
              <CommandGroup
                forceMount
                className={cn("border-t border-foreground/10 bg-secondary", "sticky bottom-0")}
              >
                <CommandItem
                  forceMount
                  value={`__create__${search}`}
                  onSelect={() => {
                    onCreateOption?.(search.trim());
                    setSearch("");
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  <span className="cube-rn-text min-w-0 flex-1 truncate text-sm text-foreground">
                    {createLabel} “{search.trim()}”
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>

        {clearable && selected.length > 0 ? (
          <div className="cube-rn-view flex-row justify-end border-t border-foreground/10 p-1">
            <Button
              variant="outline"
              size="sm"
              className="text-foreground/60"
              onClick={() => onValueChange([])}
              iconSlot={<X className="size-4" aria-hidden />}
              content="Clear"
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
