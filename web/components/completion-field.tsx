import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Combobox } from "@/components/combobox";
import { FormField } from "@/components/form-field";
import type { SelectEntry } from "@/lib/select-options";

/**
 * One blank a server can suggest answers for — a prompt's argument, a resource template's
 * variable — as free text with the server's suggestions offered as rows.
 *
 * Both pickers ask the same `completion/complete` the same way, so this is the one copy of how.
 */

/** How long typing has to pause before the server is asked what it would suggest. */
const COMPLETION_DEBOUNCE_MS = 200;

/** `value`, once it has held still for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * A suggestion is never the only answer — a server that completes a name knows the names it has
 * seen, not the one being typed — so the box holds whatever is typed and the rows are a shortcut.
 * The server is asked only while the menu is open, and only once typing pauses: a template of
 * five blanks would otherwise ask five times on open and once per keystroke after. A server that
 * cannot complete answers with none, and the menu is then just the box.
 */
export function CompletionField({
  label,
  required,
  description,
  value,
  onChange,
  queryKey,
  suggest,
}: {
  label: string;
  required?: boolean;
  description?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  /** What identifies the blank, before what is typed into it — the cache key's prefix. */
  queryKey: readonly unknown[];
  /** Asks the server for its suggestions for what has been typed. */
  suggest: (typed: string) => Promise<string[]>;
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const typed = useDebounced(search, COMPLETION_DEBOUNCE_MS);

  const suggestions = useQuery({
    queryKey: [...queryKey, typed],
    queryFn: () => suggest(typed),
    enabled: opened,
    // The last answer stays while the next is asked for, filtered by what has been typed since,
    // rather than the rows blanking on every pause.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const options: SelectEntry[] = [
    ...(suggestions.data ?? []).map((suggestion) => ({ value: suggestion, label: suggestion })),
    ...(suggestions.isFetching && !suggestions.data ? [{ note: "Asking the server…" }] : []),
    ...(suggestions.error ? [{ note: suggestions.error.message, className: "text-negative" }] : []),
  ];

  return (
    <FormField
      label={label}
      required={required}
      description={description}
      controlSlot={(wired) => (
        <Combobox
          {...wired}
          freeText
          searchable
          options={options}
          value={value || undefined}
          onValueChange={onChange}
          onOpenChange={setOpened}
          onSearchChange={setSearch}
          placeholder="Type or pick a suggestion"
          searchPlaceholder={`${label}…`}
          searchLabel={label}
          popoverLabel={`Suggestions for ${label}`}
          emptyMessage="No suggestions."
        />
      )}
    />
  );
}
