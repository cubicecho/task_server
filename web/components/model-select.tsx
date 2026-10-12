import { useQuery } from "@tanstack/react-query";
import { List } from "lucide-react";
import { useState } from "react";
import { ModelsDocument } from "@/__generated__/graphql/graphql";
import { ActionButton } from "@/components/action-button";
import { OptionSelect, type SelectEntry } from "@/components/option-select";
import { Input } from "@/components/ui/input";
import { request } from "@/lib/gql";

// Radix refuses an empty item value, so the two non-model choices carry sentinels.
const DEFAULT = "__default__";
const CUSTOM = "__custom__";

/**
 * The props a `FormField` hands its control, which this passes to whichever of its two
 * controls is on screen. Its root renders no DOM of its own, so callers inside a field reach
 * it through the function form of `control` — see `ModelSelectField`.
 */
type Wired = {
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
};

/**
 * Picks a model from whatever the configured server offers.
 *
 * The list is a live call to that server, which may not be running, so it is only fetched
 * once the menu is opened — and because it can fail, or be a server with no `/models` at
 * all, "Type a name…" drops the field back to free text.
 */
export function ModelSelect({
  value,
  onChange,
  defaultLabel,
  agentId,
  ...wired
}: Wired & {
  value: string;
  onChange: (model: string) => void;
  /** Label for the empty choice. Omitted, a model must be named. */
  defaultLabel?: string;
  /**
   * Ask this agent profile's endpoint rather than the server's. A profile that names an
   * endpoint of its own runs somewhere else, and the server's model list is not its list.
   */
  agentId?: string;
}) {
  const [typing, setTyping] = useState(false);
  const [opened, setOpened] = useState(false);

  const models = useQuery({
    // Keyed by endpoint, not by page: two profiles on two servers are two different lists.
    queryKey: ["models", agentId ?? ""],
    queryFn: () => request(ModelsDocument, { agentId }),
    enabled: opened,
    retry: false,
    staleTime: 60_000,
  });

  if (typing) {
    return (
      <div className="flex gap-2">
        <Input
          {...wired}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="llama3.1:8b"
        />
        <ActionButton
          label="Pick from the list"
          variant="ghost"
          size="icon"
          onClick={() => setTyping(false)}
        >
          <List />
        </ActionButton>
      </div>
    );
  }

  // A model saved before the server offered it still has to show as the current choice.
  const listed = models.data?.models ?? [];
  const names = value && !listed.includes(value) ? [value, ...listed] : listed;

  const options: SelectEntry[] = [
    ...(defaultLabel ? [{ value: DEFAULT, label: defaultLabel }] : []),
    ...names.map((name) => ({ value: name, label: name, className: "font-mono" })),
    ...(models.isFetching && names.length === 0 ? [{ note: "Loading…" }] : []),
    ...(models.error
      ? [{ note: (models.error as Error).message, className: "text-destructive text-xs" }]
      : []),
    { separator: true },
    { value: CUSTOM, label: "Type a name…" },
  ];

  return (
    <OptionSelect
      {...wired}
      options={options}
      value={value || (defaultLabel ? DEFAULT : "")}
      onValueChange={(next) => {
        if (next === CUSTOM) setTyping(true);
        else onChange(next === DEFAULT ? "" : next);
      }}
      onOpenChange={(open) => open && setOpened(true)}
      placeholder="Select a model"
    />
  );
}
