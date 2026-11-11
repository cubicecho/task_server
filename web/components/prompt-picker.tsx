import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  McpPromptCompletionDocument,
  McpPromptDocument,
  McpPromptsDocument,
  type McpPromptsQuery,
} from "@/__generated__/graphql/graphql";
import { Combobox } from "@/components/combobox";
import { DialogLayout } from "@/components/dialog-layout";
import { FormField } from "@/components/form-field";
import { List } from "@/components/list";
import { ListItem } from "@/components/list-item";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sparkles } from "@/components/ui/icons";
import { request } from "@/lib/gql";
import type { SelectEntry } from "@/lib/select-options";

/**
 * The prompts the connected MCP servers offer, as something you pick and then edit.
 *
 * A prompt is the server author's own phrasing of a job their server is good at, and the
 * protocol calls it user-controlled: it is meant to reach a person as a menu item, not a model
 * as a tool. So this expands into the box you are already typing in rather than into a run. What
 * comes back is text — readable, cuttable, and saved as the task's own prompt — which is the
 * difference between a starting point and a macro, and the reason a template's author changing
 * their mind next month cannot silently change what this task sends.
 */

type McpPrompt = McpPromptsQuery["mcpPrompts"][number];

/** How long typing has to pause before the server is asked what it would suggest. */
const COMPLETION_DEBOUNCE_MS = 200;

/**
 * Whether there is anything to pick, for the button below.
 *
 * Shared by every field that offers the picker, so a task with six steps asks once. No poll: the
 * list only changes when an operator edits the MCP servers page, and that page invalidates
 * `["mcp"]` on every write — which is this key's prefix, so the picker goes stale with the
 * servers it is a listing of and refetches the next time one is opened.
 */
const useMcpPrompts = () =>
  useQuery({
    queryKey: ["mcp", "prompts"],
    queryFn: () => request(McpPromptsDocument),
    staleTime: 60_000,
  });

/** A prompt's own name for itself, falling back to the id its server addresses it by. */
const titleOf = (prompt: McpPrompt) => prompt.title.trim() || prompt.name;

/**
 * An expansion added to what is already in the box, rather than over it.
 *
 * Insert is not a destructive verb, and the field it lands in usually has something in it — the
 * half-written prompt that sent somebody looking for a template in the first place.
 */
export const withPrompt = (current: string, addition: string) =>
  current.trim() ? `${current.trimEnd()}\n\n${addition}` : addition;

/**
 * The button that opens the picker, drawn only where there is something to pick.
 *
 * Absent rather than disabled: on a server with no MCP prompts configured — which is most of
 * them — a permanently greyed control beside every prompt box is an explanation owed on every
 * page for a feature nobody has turned on.
 */
export function McpPromptButton({
  onInsert,
  className,
}: {
  onInsert: (text: string) => void;
  /** For a call site placing the button itself — a flex child that has to sit at one end. */
  className?: string;
}) {
  const prompts = useMcpPrompts();
  const [open, setOpen] = useState(false);

  if (!prompts.data?.mcpPrompts.length) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
        iconSlot={<Sparkles />}
        content="MCP prompt"
      />
      {open ? (
        <PromptDialog
          prompts={prompts.data.mcpPrompts}
          onClose={() => setOpen(false)}
          onInsert={onInsert}
        />
      ) : null}
    </>
  );
}

function PromptDialog({
  prompts,
  onClose,
  onInsert,
}: {
  prompts: McpPrompt[];
  onClose: () => void;
  onInsert: (text: string) => void;
}) {
  const [chosen, setChosen] = useState<McpPrompt | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const expand = useMutation({
    // The arguments are handed over rather than read from `values`: a prompt with none is sent
    // in the same tick that clears them, when this closure still holds the ones typed for the
    // prompt before it.
    mutationFn: ({ prompt, args }: { prompt: McpPrompt; args: Record<string, string> }) =>
      request(McpPromptDocument, { server: prompt.server, name: prompt.name, args }),
    // Said in the dialog, below — see there.
    meta: { quiet: true },
    onSuccess: ({ mcpPrompt }) => {
      onInsert(mcpPrompt);
      onClose();
    },
  });

  /**
   * A template with no blanks to fill has nothing to show on a second screen, so picking it is
   * the whole interaction — one click rather than a click, an empty form and a confirm.
   */
  const pick = (prompt: McpPrompt) => {
    setValues({});
    if (prompt.arguments.length === 0) {
      expand.mutate({ prompt, args: {} });
    } else {
      setChosen(prompt);
    }
  };

  const missing = chosen?.arguments.some((arg) => arg.required && !values[arg.name]?.trim());

  return (
    <DialogLayout
      open
      onOpenChange={(next) => !next && onClose()}
      size="lg"
      title={chosen ? titleOf(chosen) : "Insert an MCP prompt"}
      description={
        chosen
          ? chosen.description || `A prompt ${chosen.serverLabel} offers.`
          : "What the connected MCP servers say they are good at. The one you pick is expanded " +
            "into the box as text you can still edit — the task saves the text, not the template."
      }
      contentSlot={
        <div className="flex flex-col gap-3">
          {chosen ? (
            chosen.arguments.map((arg, index) => (
              <ArgumentField
                key={arg.name}
                prompt={chosen}
                argument={arg}
                value={values[arg.name] ?? ""}
                onChange={(next) => setValues((held) => ({ ...held, [arg.name]: next }))}
                context={filledBefore(chosen, index, values)}
              />
            ))
          ) : (
            <List
              label="MCP prompts"
              contentSlot={prompts.map((prompt) => (
                <ListItem
                  key={`${prompt.server}/${prompt.name}`}
                  onClick={() => pick(prompt)}
                  title={titleOf(prompt)}
                  description={prompt.description || undefined}
                  meta={prompt.serverLabel}
                />
              ))}
            />
          )}

          {/* Said here rather than as a toast: the dialog is still open, and this is where the
              arguments that may be wrong are. */}
          {expand.error ? (
            <Alert
              variant="destructive"
              description={expand.error.message || "That prompt could not be expanded."}
            />
          ) : null}
        </div>
      }
      footerActionsSlot={(close) => (
        <>
          <Button
            variant="outline"
            onClick={chosen ? () => setChosen(null) : close}
            content={chosen ? "Back" : "Cancel"}
          />
          {chosen ? (
            <Button
              onClick={() => expand.mutate({ prompt: chosen, args: values })}
              disabled={missing || expand.isPending}
              // A required blank is why the button is off, and a disabled button explains
              // nothing on its own.
              hint={missing ? "Fill in the required arguments first." : undefined}
              content={expand.isPending ? "Expanding…" : "Insert"}
            />
          ) : null}
        </>
      )}
    />
  );
}

/**
 * The arguments above this one that have something in them, which is what a server narrows a
 * later one by — the folder before the document in it. Only the earlier ones: a later blank
 * filled first is a guess about an order the template's author did not choose.
 */
function filledBefore(prompt: McpPrompt, index: number, values: Record<string, string>) {
  return Object.fromEntries(
    prompt.arguments
      .slice(0, index)
      .map((arg) => [arg.name, values[arg.name]?.trim() ?? ""] as const)
      .filter(([, value]) => value !== ""),
  );
}

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
 * One blank of a template: free text, with what the server suggests for it offered as rows.
 *
 * A suggestion is never the only answer — a server that completes a name knows the names it has
 * seen, not the one being typed — so the box holds whatever is typed and the rows are a shortcut.
 * The server is asked only while the menu is open, and only once typing pauses: a template of
 * five blanks would otherwise ask five times on open and once per keystroke after. A server that
 * cannot complete answers with none, and the menu is then just the box.
 */
function ArgumentField({
  prompt,
  argument,
  value,
  onChange,
  context,
}: {
  prompt: McpPrompt;
  argument: McpPrompt["arguments"][number];
  value: string;
  onChange: (value: string) => void;
  context: Record<string, string>;
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const typed = useDebounced(search, COMPLETION_DEBOUNCE_MS);

  const suggestions = useQuery({
    queryKey: [
      "mcp",
      "prompts",
      "complete",
      prompt.server,
      prompt.name,
      argument.name,
      typed,
      context,
    ],
    queryFn: () =>
      request(McpPromptCompletionDocument, {
        server: prompt.server,
        name: prompt.name,
        argument: argument.name,
        value: typed,
        context,
      }),
    enabled: opened,
    // The last answer stays while the next is asked for, filtered by what has been typed since,
    // rather than the rows blanking on every pause.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const options: SelectEntry[] = [
    ...(suggestions.data?.mcpPromptCompletion ?? []).map((suggestion) => ({
      value: suggestion,
      label: suggestion,
    })),
    ...(suggestions.isFetching && !suggestions.data ? [{ note: "Asking the server…" }] : []),
    ...(suggestions.error ? [{ note: suggestions.error.message, className: "text-negative" }] : []),
  ];

  return (
    <FormField
      label={argument.name}
      required={argument.required}
      description={argument.description || undefined}
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
          searchPlaceholder={`${argument.name}…`}
          searchLabel={argument.name}
          popoverLabel={`Suggestions for ${argument.name}`}
          emptyMessage="No suggestions."
        />
      )}
    />
  );
}
