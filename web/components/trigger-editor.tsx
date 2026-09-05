import { Check, Copy, Plus, Trash2 } from "lucide-react";
import type { TaskFieldsFragment } from "@/__generated__/graphql/graphql";
import { ActionButton } from "@/components/action-button";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/lib/use-copy";

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
 * An unguessable webhook id.
 *
 * The id is the whole of the address and the whole of the authentication — there is no secret
 * and no signature (see `AGENTS.md`) — so the default has to be something nobody arrives at by
 * trying. 26 characters of a 32-letter alphabet is 130 bits.
 *
 * `crypto.randomUUID` is not used: it is unavailable outside a secure context, and this server
 * is very often reached over plain http at a LAN address. `getRandomValues` is always there.
 * The alphabet is 32 letters exactly so that `% 32` over a byte stays uniform, and it drops
 * `i`, `l`, `o` and `u` so an id read off a screen cannot be transcribed into a different one.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function newWebhookId(): string {
  const bytes = new Uint8Array(26);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

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
    if (trigger.id) onRemoveSaved(trigger.id);
    onChange(triggers.filter((current) => current.key !== trigger.key));
  };

  const cron = triggers.filter((trigger) => trigger.kind === "cron");
  const webhooks = triggers.filter((trigger) => trigger.kind === "event");

  return (
    <>
      <Section
        title="Schedule"
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => add({ kind: "cron", cron: "", timezone: "", event: "", enabled: true })}
          >
            <Plus className="size-4" />
            Add
          </Button>
        }
        content={
          <>
            {cron.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No schedule — the task only runs when you press play.
              </p>
            ) : null}

            {cron.map((trigger) => (
              <div key={trigger.key} className="flex items-center gap-2">
                <Input
                  className="font-mono"
                  value={trigger.cron}
                  onChange={(event) => patch(trigger.key, { cron: event.target.value })}
                  placeholder="0 9 * * *"
                  aria-label="Cron expression"
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
                <ActionButton
                  type="button"
                  label="Remove this schedule"
                  variant="ghost"
                  size="icon"
                  onClick={() => drop(trigger)}
                >
                  <Trash2 />
                </ActionButton>
              </div>
            ))}

            <div className="flex gap-2 text-muted-foreground text-xs">
              {CRON_EXAMPLES.map((example) => (
                <button
                  key={example.cron}
                  type="button"
                  className="rounded-md border px-2 py-1 hover:bg-accent"
                  onClick={() =>
                    add({
                      kind: "cron",
                      cron: example.cron,
                      timezone: "",
                      event: "",
                      enabled: true,
                    })
                  }
                >
                  {example.label} <span className="font-mono">{example.cron}</span>
                </button>
              ))}
            </div>
          </>
        }
      />

      <Section
        title="Webhooks"
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              add({ kind: "event", cron: "", timezone: "", event: newWebhookId(), enabled: true })
            }
          >
            <Plus className="size-4" />
            Add
          </Button>
        }
        content={
          <>
            {webhooks.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No webhooks — nothing outside can start this task.
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
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
  const { copied, copy } = useCopy();

  return (
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center rounded-md border bg-muted/40 pl-3 font-mono text-sm">
        {/* The origin is shown but not editable: it is where this page came from, not a setting. */}
        <span className="shrink-0 text-muted-foreground">{window.location.origin}/webhooks/</span>
        <Input
          id={`webhook-${trigger.key}`}
          className="border-0 bg-transparent font-mono shadow-none focus-visible:ring-0"
          value={trigger.event}
          onChange={(input) => onChange(input.target.value.trim())}
          placeholder="(an id is required)"
          aria-label="Webhook id"
          spellCheck={false}
        />
      </div>
      <ActionButton
        type="button"
        label={copied ? "Copied" : "Copy the URL"}
        variant="ghost"
        size="icon"
        disabled={!trigger.event}
        hint={trigger.event ? undefined : "Give the webhook an id first"}
        onClick={() => void copy(webhookUrl(trigger.event))}
      >
        {copied ? <Check /> : <Copy />}
      </ActionButton>
      <Button type="button" variant="ghost" size="sm" onClick={onRegenerate}>
        New id
      </Button>
      <TriggerSwitch trigger={trigger} onChange={onToggle} />
      <ActionButton
        type="button"
        label="Remove this webhook"
        variant="ghost"
        size="icon"
        onClick={onRemove}
      >
        <Trash2 />
      </ActionButton>
    </div>
  );
}
