import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import {
  McpPromptDocument,
  McpPromptsDocument,
  type McpPromptsQuery,
} from "@/__generated__/graphql/graphql";
import { DialogLayout } from "@/components/dialog-layout";
import { FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { request } from "@/lib/gql";

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

  if (!prompts.data?.mcpPrompts.length) return null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="size-3.5" aria-hidden />
        MCP prompt
      </Button>
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
    mutationFn: (prompt: McpPrompt) =>
      request(McpPromptDocument, { server: prompt.server, name: prompt.name, args: values }),
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
    if (prompt.arguments.length === 0) expand.mutate(prompt);
    else setChosen(prompt);
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
      content={
        <div className="flex flex-col gap-3">
          {chosen ? (
            chosen.arguments.map((arg) => (
              <FormField
                key={arg.name}
                label={arg.name}
                required={arg.required}
                description={arg.description || undefined}
                control={
                  <Input
                    value={values[arg.name] ?? ""}
                    onChange={(event) =>
                      setValues((held) => ({ ...held, [arg.name]: event.target.value }))
                    }
                  />
                }
              />
            ))
          ) : (
            <div className="flex flex-col gap-2">
              {prompts.map((prompt) => (
                <button
                  key={`${prompt.server}/${prompt.name}`}
                  type="button"
                  onClick={() => pick(prompt)}
                  className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-left hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 font-medium text-sm">{titleOf(prompt)}</span>
                    <Badge variant="secondary">{prompt.serverLabel}</Badge>
                  </div>
                  {prompt.description ? (
                    <span className="text-muted-foreground text-sm">{prompt.description}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}

          {/* Said here rather than as a toast: the dialog is still open, and this is where the
              arguments that may be wrong are. */}
          {expand.error ? (
            <p className="text-destructive text-sm">
              {(expand.error as Error).message || "That prompt could not be expanded."}
            </p>
          ) : null}
        </div>
      }
      footerActions={(close) => (
        <>
          <Button variant="ghost" onClick={chosen ? () => setChosen(null) : close}>
            {chosen ? "Back" : "Cancel"}
          </Button>
          {chosen ? (
            <Button
              onClick={() => expand.mutate(chosen)}
              disabled={missing || expand.isPending}
              // A required blank is why the button is off, and a disabled button explains
              // nothing on its own.
              title={missing ? "Fill in the required arguments first." : undefined}
            >
              {expand.isPending ? "Expanding…" : "Insert"}
            </Button>
          ) : null}
        </>
      )}
    />
  );
}
