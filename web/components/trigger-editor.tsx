import type { ComponentProps, ReactNode } from "react";
import type { TaskFieldsFragment } from "@/__generated__/graphql/graphql";
import { FormField } from "@/components/form-field";
import { EmptyState } from "@/components/page";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Copy, Plus, Trash2 } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { triggerProblem } from "@/lib/triggers";

/**
 * The two things that can start a task: a schedule, and a webhook.
 *
 * Both are rows in the same `triggers` table and both are saved by the same loop, so they are
 * held in one list and told apart by `kind` — but they are nothing alike to look at, and a cron
 * expression and a URL do not belong in the same column. Hence two sections over one array.
 */

/** A trigger being edited. `id` is absent until it has been saved. */
export interface DraftTrigger {
  /** React's key, stable across every edit — an unsaved trigger has one of these and no `id`. */
  key: string;
  id?: string;
  kind: "cron" | "event";
  cron: string;
  timezone: string;
  event: string;
  /**
   * Whether this one trigger fires, independently of the task's own switch.
   *
   * The column has always been there and the dispatchers have always honoured it; nothing in
   * the UI could set it, so every trigger the editor saved came back on. It is the switch for
   * silencing one schedule while leaving the task and its other triggers alone.
   */
  enabled: boolean;
}

let counter = 0;
const nextKey = () => `trigger-${++counter}`;

/**
 * 32 letters exactly, so that `% 32` over a byte stays uniform, and without `i`, `l`, `o` and
 * `u`, so an id read off a screen cannot be transcribed into a different one.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * An unguessable webhook id.
 *
 * The id is the whole of the address and the whole of the authentication — there is no secret
 * and no signature (see `AGENTS.md`) — so the default has to be something nobody arrives at by
 * trying. 26 characters of a 32-letter alphabet is 130 bits.
 *
 * `crypto.randomUUID` is not used: it is unavailable outside a secure context, and this server
 * is very often reached over plain http at a LAN address. `getRandomValues` is always there.
 */
function newWebhookId(): string {
  const bytes = new Uint8Array(26);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/** A trigger of this kind with nothing filled in, armed. */
const emptyTrigger = (kind: DraftTrigger["kind"]): Omit<DraftTrigger, "key"> => ({
  kind,
  cron: "",
  timezone: "",
  event: "",
  enabled: true,
});

/** The saved rows, as the editor holds them. */
export const toDraftTriggers = (rows: TaskFieldsFragment["triggers"]): DraftTrigger[] =>
  rows.map((row) => ({
    key: row.id,
    id: row.id,
    kind: row.kind === "event" ? "event" : "cron",
    cron: row.cron,
    timezone: row.timezone,
    event: row.event,
    enabled: row.enabled,
  }));

const CRON_EXAMPLES = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Weekday mornings", cron: "0 9 * * 1-5" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
];

interface EditorProps {
  triggers: DraftTrigger[];
  onChange: (next: DraftTrigger[]) => void;
  /** Called with the id of a trigger that had been saved, so the parent can delete the row. */
  onRemoveSaved: (id: string) => void;
}

export function TriggerEditor({ triggers, onChange, onRemoveSaved }: EditorProps) {
  const patch = (key: string, values: Partial<DraftTrigger>) =>
    onChange(
      triggers.map((trigger) => (trigger.key === key ? { ...trigger, ...values } : trigger)),
    );

  const add = (trigger: Omit<DraftTrigger, "key">) =>
    onChange([...triggers, { ...trigger, key: nextKey() }]);

  const drop = (trigger: DraftTrigger) => {
    if (trigger.id) {
      onRemoveSaved(trigger.id);
    }
    onChange(triggers.filter((current) => current.key !== trigger.key));
  };

  const cron = triggers.filter((trigger) => trigger.kind === "cron");
  const webhooks = triggers.filter((trigger) => trigger.kind === "event");

  return (
    <>
      <Section
        title="Schedule"
        actionSlot={
          <Button
            variant="info-outline"
            size="sm"
            onClick={() => add(emptyTrigger("cron"))}
            iconSlot={<Plus />}
            content="Add"
          />
        }
        contentSlot={
          <>
            {cron.length === 0 ? (
              <EmptyState compact title="No schedule — the task only runs when you press play." />
            ) : null}

            {cron.map((trigger) => (
              <TriggerRow
                key={trigger.key}
                trigger={trigger}
                content={(invalid) => (
                  <>
                    <Input
                      className="font-mono"
                      value={trigger.cron}
                      onChange={(event) => patch(trigger.key, { cron: event.target.value })}
                      placeholder="0 9 * * *"
                      aria-label="Cron expression"
                      {...invalid}
                    />
                    <Input
                      className="w-52"
                      value={trigger.timezone}
                      onChange={(event) => patch(trigger.key, { timezone: event.target.value })}
                      placeholder="America/Chicago"
                      aria-label="Time zone"
                    />
                    <TriggerSwitch
                      trigger={trigger}
                      onChange={(enabled) => patch(trigger.key, { enabled })}
                    />
                    <Button
                      aria-label="Remove this schedule"
                      variant="destructive-outline"
                      size="icon"
                      onClick={() => drop(trigger)}
                      iconSlot={<Trash2 />}
                    />
                  </>
                )}
              />
            ))}

            <div className="flex flex-wrap gap-2">
              {CRON_EXAMPLES.map((example) => (
                <Button
                  key={example.cron}
                  variant="outline"
                  size="sm"
                  hint={example.cron}
                  onClick={() => add({ ...emptyTrigger("cron"), cron: example.cron })}
                  iconSlot={<Plus />}
                  content={example.label}
                />
              ))}
            </div>
          </>
        }
      />

      <Section
        title="Webhooks"
        actionSlot={
          <Button
            variant="info-outline"
            size="sm"
            onClick={() => add({ ...emptyTrigger("event"), event: newWebhookId() })}
            iconSlot={<Plus />}
            content="Add"
          />
        }
        contentSlot={
          <>
            {webhooks.length === 0 ? (
              <EmptyState compact title="No webhooks — nothing outside can start this task." />
            ) : (
              <p className="text-foreground/60 text-sm">
                A <code className="font-mono">POST</code> to one of these runs the task. There is no
                secret beyond the address itself, so treat the URL as one and generate a new id
                rather than picking a memorable one for anything you would rather strangers could
                not fire.
              </p>
            )}

            {webhooks.map((trigger) => (
              <WebhookRow
                key={trigger.key}
                trigger={trigger}
                onChange={(event) => patch(trigger.key, { event })}
                onRemove={() => drop(trigger)}
                onRegenerate={() => patch(trigger.key, { event: newWebhookId() })}
                onToggle={(enabled) => patch(trigger.key, { enabled })}
              />
            ))}
          </>
        }
      />
    </>
  );
}

/** What `FormField` wires onto a control. The registry does not export its own name for it. */
type Wired = Pick<
  ComponentProps<"input">,
  "id" | "aria-labelledby" | "aria-describedby" | "aria-invalid" | "aria-required"
>;

/**
 * One trigger's controls in a row, with the reason it cannot be saved underneath.
 *
 * `content` is handed what `FormField` wires onto a control — the error's id among it — for the
 * row's own input to carry, so the reason is announced with the input it is about.
 */
function TriggerRow({
  trigger,
  content,
}: {
  trigger: DraftTrigger;
  content: (wired: Wired) => ReactNode;
}) {
  return (
    <FormField
      error={triggerProblem(trigger)}
      controlSlot={(wired) => <div className="flex items-center gap-2">{content(wired)}</div>}
    />
  );
}

/**
 * On or off for this one trigger.
 *
 * Off is not the same as deleted, and that is the point of having both: a webhook id kept but
 * silenced is one that can be turned back on without the sender having to be repointed at a new
 * address, and a schedule paused for a week is not a schedule someone has to remember.
 */
function TriggerSwitch({
  trigger,
  onChange,
}: {
  trigger: DraftTrigger;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <Switch
      checked={trigger.enabled}
      onCheckedChange={onChange}
      aria-label={trigger.enabled ? "Disable this trigger" : "Enable this trigger"}
      title={trigger.enabled ? "Firing. Click to silence it." : "Silenced. Click to arm it."}
    />
  );
}

/** Where the id in this row can be reached, as the browser is reaching this page. */
const webhookUrl = (event: string) => `${window.location.origin}/webhooks/${event}`;

function WebhookRow({
  trigger,
  onChange,
  onRemove,
  onRegenerate,
  onToggle,
}: {
  trigger: DraftTrigger;
  onChange: (event: string) => void;
  onRemove: () => void;
  onRegenerate: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const toast = useToast();

  return (
    <TriggerRow
      trigger={trigger}
      content={(invalid) => (
        <>
          <div className="flex min-w-0 flex-1 items-center rounded-md border bg-foreground/10 pl-3 font-mono text-sm">
            {/* The origin is shown but not editable: it is where this page came from, not a setting. */}
            <span className="shrink-0 text-foreground/60">{window.location.origin}/webhooks/</span>
            <Input
              className="border-0 bg-transparent font-mono shadow-none focus-visible:ring-0"
              value={trigger.event}
              onChange={(input) => onChange(input.target.value.trim())}
              placeholder="(an id is required)"
              aria-label="Webhook id"
              spellCheck={false}
              {...invalid}
            />
          </div>
          {trigger.event ? (
            <CopyButton
              value={webhookUrl(trigger.event)}
              label="Copy the URL"
              size="icon"
              onError={() => toast("Could not copy. Select the text and copy it by hand.")}
            />
          ) : (
            // CopyButton takes no `disabled` and no `hint`, and an empty id has nothing to copy.
            <Button
              aria-label="Copy the URL"
              variant="outline"
              size="icon"
              disabled
              hint="Give the webhook an id first"
              iconSlot={<Copy />}
            />
          )}
          <Button variant="outline" size="sm" onClick={onRegenerate} content="New id" />
          <TriggerSwitch trigger={trigger} onChange={onToggle} />
          <Button
            aria-label="Remove this webhook"
            variant="destructive-outline"
            size="icon"
            onClick={onRemove}
            iconSlot={<Trash2 />}
          />
        </>
      )}
    />
  );
}
