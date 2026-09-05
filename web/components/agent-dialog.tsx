import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  type AgentFieldsFragment,
  type AgentsQuery,
  AgentsToolDiscoveryEnum,
  CreateAgentDocument,
  SetAgentApiKeyDocument,
  UpdateAgentDocument,
} from "@/__generated__/graphql/graphql";
import { Field } from "@/components/field";
import { ModelSelect } from "@/components/model-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { describeFor } from "@/lib/docs";
import { request } from "@/lib/gql";

type Server = AgentsQuery["mcpServers"][number];

/** The notes under this form's fields are the columns' own descriptions. */
const doc = describeFor("Agent");

/**
 * The form's own shape: the row without its id, its timestamps or the tasks on it.
 *
 * `mcpServerIds` is a list here rather than the nullable JSON the column holds — an absent
 * list and an empty one both mean "every server", and the form only has to say one of them.
 */
interface Draft {
  name: string;
  description: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  toolDiscovery: AgentsToolDiscoveryEnum;
  toolSelectModel: string;
  requestTimeoutSeconds: number;
  maxRetries: number;
  mcpServerIds: string[];
}

const toDraft = (agent?: AgentFieldsFragment): Draft => ({
  name: agent?.name ?? "",
  description: agent?.description ?? "",
  baseUrl: agent?.baseUrl ?? "",
  model: agent?.model ?? "",
  systemPrompt: agent?.systemPrompt ?? "",
  maxTokens: agent?.maxTokens ?? -1,
  temperature: agent?.temperature ?? -1,
  maxToolIterations: agent?.maxToolIterations ?? -1,
  toolDiscovery: agent?.toolDiscovery ?? AgentsToolDiscoveryEnum.Inherit,
  toolSelectModel: agent?.toolSelectModel ?? "",
  requestTimeoutSeconds: agent?.requestTimeoutSeconds ?? -1,
  maxRetries: agent?.maxRetries ?? -1,
  // The JSON scalar carries no shape, so this is where it is said what the column holds.
  mcpServerIds: (agent?.mcpServerIds as string[] | null) ?? [],
});

/**
 * A number that may be left to settings, where an empty box is how that is said.
 *
 * The column stores `-1` for "ask settings" — zero is a real answer for retries, for patience
 * and for tokens, so the sentinel has to be a value none of them can hold — and nobody should
 * have to know that to fill in a form. Blank is inherit, and inherit shows as blank.
 */
function InheritField({
  id,
  label,
  hint,
  value,
  step,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  step?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type="number"
        step={step}
        placeholder="From settings"
        value={value < 0 ? "" : String(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          // A half-typed "-" parses to NaN, and an emptied box to "". Both are inherit.
          onChange(event.target.value.trim() === "" || !Number.isFinite(next) ? -1 : next);
        }}
      />
    </Field>
  );
}

export function AgentDialog({
  agent,
  servers,
  onClose,
  onSaved,
}: {
  agent?: AgentFieldsFragment;
  servers: Server[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(agent));
  const [apiKey, setApiKey] = useState("");
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const toggleServer = (id: string, on: boolean) =>
    set({
      mcpServerIds: on
        ? [...draft.mcpServerIds, id]
        : draft.mcpServerIds.filter((current) => current !== id),
    });

  const save = useMutation({
    mutationFn: async () => {
      const values = {
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        baseUrl: draft.baseUrl.trim(),
        // An empty list is stored as null, which is the column's own word for "every server":
        // a profile nobody has narrowed and one narrowed to nothing would otherwise differ.
        mcpServerIds: draft.mcpServerIds.length ? draft.mcpServerIds : null,
      };
      if (!values.name) throw new Error("A profile needs a name.");

      const id = agent
        ? ((await request(UpdateAgentDocument, { id: agent.id, set: values })).updateAgentSingle
            ?.id ?? agent.id)
        : (await request(CreateAgentDocument, { values })).createAgent.id;

      // The key travels on its own mutation because it is write-only, exactly as the server's
      // own key does — it is excluded from the Agent type and can never be read back.
      if (apiKey) await request(SetAgentApiKeyDocument, { agentId: id, apiKey });
      setApiKey("");
    },
    onSuccess: () => {
      toast.success(agent ? "Profile saved" : "Profile created");
      onSaved();
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit profile" : "New agent profile"}</DialogTitle>
          <DialogDescription>
            Everything left blank comes from Settings, so a profile only has to say what it changes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" htmlFor="name" hint={doc("name")}>
              <Input
                id="name"
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
                placeholder="Local Qwen"
              />
            </Field>
            <Field label="Description" htmlFor="description">
              <Input
                id="description"
                value={draft.description}
                onChange={(event) => set({ description: event.target.value })}
                placeholder="Cheap and offline"
              />
            </Field>
          </div>

          <Field label="Base URL" htmlFor="baseUrl" hint={doc("baseUrl")}>
            <Input
              id="baseUrl"
              value={draft.baseUrl}
              onChange={(event) => set({ baseUrl: event.target.value })}
              placeholder="(from settings)"
            />
          </Field>

          <Field
            label="API key"
            htmlFor="apiKey"
            hint="Only needed for an endpoint of this profile's own. One that names an endpoint never borrows the server's key."
          >
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={agent ? "unchanged — leave blank to keep the stored key" : "sk-…"}
            />
          </Field>

          <Field
            label="Model"
            htmlFor="model"
            hint="Opening the list asks this profile's endpoint for its models, so save a new base URL first."
          >
            <ModelSelect
              id="model"
              value={draft.model}
              onChange={(model) => set({ model })}
              defaultLabel="Default from Settings"
              agentId={agent?.id}
            />
          </Field>

          <Field label="System prompt" htmlFor="systemPrompt" hint={doc("systemPrompt")}>
            <Textarea
              id="systemPrompt"
              rows={3}
              value={draft.systemPrompt}
              onChange={(event) => set({ systemPrompt: event.target.value })}
              placeholder="(from settings)"
            />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <InheritField
              id="maxTokens"
              label="Max tokens"
              value={draft.maxTokens}
              onChange={(maxTokens) => set({ maxTokens })}
            />
            <InheritField
              id="temperature"
              label="Temperature"
              step="0.1"
              value={draft.temperature}
              onChange={(temperature) => set({ temperature })}
            />
            <InheritField
              id="maxToolIterations"
              label="Max tool steps"
              value={draft.maxToolIterations}
              onChange={(maxToolIterations) => set({ maxToolIterations })}
            />
            <InheritField
              id="requestTimeoutSeconds"
              label="Silence before giving up (s)"
              value={draft.requestTimeoutSeconds}
              onChange={(requestTimeoutSeconds) => set({ requestTimeoutSeconds })}
            />
            <InheritField
              id="maxRetries"
              label="Retries"
              value={draft.maxRetries}
              onChange={(maxRetries) => set({ maxRetries })}
            />
          </div>

          <Field label="Tool discovery" htmlFor="toolDiscovery" hint={doc("toolDiscovery")}>
            <Select
              value={draft.toolDiscovery}
              onValueChange={(value) => set({ toolDiscovery: value as AgentsToolDiscoveryEnum })}
            >
              <SelectTrigger id="toolDiscovery" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AgentsToolDiscoveryEnum.Inherit}>From settings</SelectItem>
                <SelectItem value={AgentsToolDiscoveryEnum.Eager}>
                  Eager — send every definition every time
                </SelectItem>
                <SelectItem value={AgentsToolDiscoveryEnum.Ondemand}>
                  On demand — load definitions as needed
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Tool-picking model" htmlFor="toolSelectModel" hint={doc("toolSelectModel")}>
            <ModelSelect
              id="toolSelectModel"
              value={draft.toolSelectModel}
              onChange={(toolSelectModel) => set({ toolSelectModel })}
              defaultLabel="From settings"
              agentId={agent?.id}
            />
          </Field>

          <Field label="MCP servers" hint={doc("mcpServerIds")}>
            {servers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No MCP servers configured, so there is nothing to narrow.
              </p>
            ) : (
              <div className="flex flex-col gap-2 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  {draft.mcpServerIds.length === 0
                    ? "None picked — a task on this profile reaches every enabled server."
                    : `${draft.mcpServerIds.length} of ${servers.length} — a task on this profile reaches no others.`}
                </p>
                {servers.map((server) => (
                  <div key={server.id} className="flex items-center justify-between gap-3">
                    <Label htmlFor={`server-${server.id}`} className="font-mono text-sm">
                      {server.label || server.slug}
                      {server.enabled ? null : (
                        <span className="text-muted-foreground"> (disabled)</span>
                      )}
                    </Label>
                    <Switch
                      id={`server-${server.id}`}
                      checked={draft.mcpServerIds.includes(server.id)}
                      onCheckedChange={(on) => toggleServer(server.id, on)}
                    />
                  </div>
                ))}
              </div>
            )}
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
