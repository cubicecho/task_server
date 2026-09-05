import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  type AgentFieldsFragment,
  type AgentsQuery,
  AgentsToolDiscoveryEnum,
  CreateAgentDocument,
  SetAgentApiKeyDocument,
  UpdateAgentDocument,
} from "@/__generated__/graphql/graphql";
import { useAppForm } from "@/components/app-form";
import { DialogLayout } from "@/components/dialog-layout";
import { FieldRow } from "@/components/field-row";
import { ModelSelectField } from "@/components/model-select-field";
import { MultiSelectField } from "@/components/multi-select-field";
import { PasswordField } from "@/components/password-field";
import { RadioGroupField } from "@/components/radio-group-field";
import { Button } from "@/components/ui/button";
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
 *
 * The five numbers are `number | null` where the column stores `-1`. The column needs a sentinel
 * because zero is a real answer for retries, for patience and for tokens; a form does not, and an
 * empty box is what "leave it to settings" looks like. {@link toValues} is where the two meet.
 */
interface Draft {
  name: string;
  description: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens: number | null;
  temperature: number | null;
  maxToolIterations: number | null;
  toolDiscovery: AgentsToolDiscoveryEnum;
  toolSelectModel: string;
  requestTimeoutSeconds: number | null;
  maxRetries: number | null;
  mcpServerIds: string[];
}

/** `-1` is the column's word for inherit; an empty box is the form's. */
const inherited = (value: number | null) => value ?? -1;
const shown = (value: number) => (value < 0 ? null : value);

const toDraft = (agent?: AgentFieldsFragment): Draft => ({
  name: agent?.name ?? "",
  description: agent?.description ?? "",
  baseUrl: agent?.baseUrl ?? "",
  // Write-only, and never sent back: blank means "keep whatever is stored".
  apiKey: "",
  model: agent?.model ?? "",
  systemPrompt: agent?.systemPrompt ?? "",
  maxTokens: shown(agent?.maxTokens ?? -1),
  temperature: shown(agent?.temperature ?? -1),
  maxToolIterations: shown(agent?.maxToolIterations ?? -1),
  toolDiscovery: agent?.toolDiscovery ?? AgentsToolDiscoveryEnum.Inherit,
  toolSelectModel: agent?.toolSelectModel ?? "",
  requestTimeoutSeconds: shown(agent?.requestTimeoutSeconds ?? -1),
  maxRetries: shown(agent?.maxRetries ?? -1),
  // The JSON scalar carries no shape, so this is where it is said what the column holds.
  mcpServerIds: (agent?.mcpServerIds as string[] | null) ?? [],
});

/** The draft as the row wants it — sentinels back in, and the key left behind. */
function toValues(draft: Draft) {
  const { apiKey: _apiKey, ...rest } = draft;
  return {
    ...rest,
    name: draft.name.trim(),
    description: draft.description.trim(),
    baseUrl: draft.baseUrl.trim(),
    maxTokens: inherited(draft.maxTokens),
    temperature: inherited(draft.temperature),
    maxToolIterations: inherited(draft.maxToolIterations),
    requestTimeoutSeconds: inherited(draft.requestTimeoutSeconds),
    maxRetries: inherited(draft.maxRetries),
    // An empty list is stored as null, which is the column's own word for "every server":
    // a profile nobody has narrowed and one narrowed to nothing would otherwise differ.
    mcpServerIds: draft.mcpServerIds.length ? draft.mcpServerIds : null,
  };
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
  const save = useMutation({
    mutationFn: async (draft: Draft) => {
      const values = toValues(draft);
      const id = agent
        ? ((await request(UpdateAgentDocument, { id: agent.id, set: values })).updateAgentSingle
            ?.id ?? agent.id)
        : (await request(CreateAgentDocument, { values })).createAgent.id;

      // The key travels on its own mutation because it is write-only, exactly as the server's
      // own key does — it is excluded from the Agent type and can never be read back.
      if (draft.apiKey)
        await request(SetAgentApiKeyDocument, { agentId: id, apiKey: draft.apiKey });
    },
    onSuccess: () => {
      toast.success(agent ? "Profile saved" : "Profile created");
      onSaved();
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const form = useAppForm({
    defaultValues: toDraft(agent),
    onSubmit: ({ value }) => save.mutateAsync(value),
  });

  return (
    <DialogLayout
      open
      onOpenChange={(open) => !open && onClose()}
      hasUnsavedChanges={form.state.isDirty}
      size="lg"
      title={agent ? "Edit profile" : "New agent profile"}
      description="Everything left blank comes from Settings, so a profile only has to say what it changes."
      content={
        <form
          id="agent-profile"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldRow
            content={
              <>
                <form.AppField
                  name="name"
                  validators={{
                    onChange: ({ value }: { value: string }) =>
                      value.trim() ? undefined : "A profile needs a name.",
                  }}
                >
                  {(field) => (
                    <field.InputField
                      label="Name"
                      description={doc("name")}
                      required
                      placeholder="Local Qwen"
                    />
                  )}
                </form.AppField>
                <form.AppField name="description">
                  {(field) => (
                    <field.InputField label="Description" placeholder="Cheap and offline" />
                  )}
                </form.AppField>
              </>
            }
          />

          <form.AppField name="baseUrl">
            {(field) => (
              <field.InputField
                label="Base URL"
                description={doc("baseUrl")}
                placeholder="(from settings)"
              />
            )}
          </form.AppField>

          <PasswordField
            form={form}
            name="apiKey"
            label="API key"
            description="Only needed for an endpoint of this profile's own. One that names an endpoint never borrows the server's key."
            placeholder={agent ? "unchanged — leave blank to keep the stored key" : "sk-…"}
          />

          <ModelSelectField
            form={form}
            name="model"
            label="Model"
            description="Opening the list asks this profile's endpoint for its models, so save a new base URL first."
            defaultLabel="Default from Settings"
            agentId={agent?.id}
          />

          <form.AppField name="systemPrompt">
            {(field) => (
              <field.TextareaField
                label="System prompt"
                description={doc("systemPrompt")}
                rows={3}
                placeholder="(from settings)"
              />
            )}
          </form.AppField>

          <FieldRow
            perRow={3}
            content={
              <>
                <form.AppField name="maxTokens">
                  {(field) => <field.NumberField label="Max tokens" placeholder="From settings" />}
                </form.AppField>
                <form.AppField name="temperature">
                  {(field) => (
                    <field.NumberField label="Temperature" step="0.1" placeholder="From settings" />
                  )}
                </form.AppField>
                <form.AppField name="maxToolIterations">
                  {(field) => (
                    <field.NumberField label="Max tool steps" placeholder="From settings" />
                  )}
                </form.AppField>
                <form.AppField name="requestTimeoutSeconds">
                  {(field) => (
                    <field.NumberField
                      label="Silence before giving up (s)"
                      placeholder="From settings"
                    />
                  )}
                </form.AppField>
                <form.AppField name="maxRetries">
                  {(field) => <field.NumberField label="Retries" placeholder="From settings" />}
                </form.AppField>
              </>
            }
          />

          <RadioGroupField
            form={form}
            name="toolDiscovery"
            label="Tool discovery"
            description={doc("toolDiscovery")}
            options={[
              { value: AgentsToolDiscoveryEnum.Inherit, label: "From settings" },
              {
                value: AgentsToolDiscoveryEnum.Eager,
                label: "Eager",
                description: "Send every definition every time.",
              },
              {
                value: AgentsToolDiscoveryEnum.Ondemand,
                label: "On demand",
                description: "Load definitions as the run asks for them.",
              },
            ]}
          />

          <ModelSelectField
            form={form}
            name="toolSelectModel"
            label="Tool-picking model"
            description={doc("toolSelectModel")}
            defaultLabel="From settings"
            agentId={agent?.id}
          />

          {servers.length === 0 ? null : (
            <form.Subscribe selector={(state) => state.values.mcpServerIds.length}>
              {(picked) => (
                <MultiSelectField
                  form={form}
                  name="mcpServerIds"
                  label="MCP servers"
                  description={
                    picked === 0
                      ? "None picked — a task on this profile reaches every enabled server."
                      : `${picked} of ${servers.length} — a task on this profile reaches no others.`
                  }
                  placeholder="Every enabled server"
                  searchLabel="Search servers"
                  popoverLabel="MCP servers"
                  options={servers.map((server) => ({
                    value: server.id,
                    label: `${server.label || server.slug}${server.enabled ? "" : " (disabled)"}`,
                    keywords: [server.slug],
                  }))}
                />
              )}
            </form.Subscribe>
          )}
        </form>
      }
      footerActions={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton form="agent-profile">Save</form.SubmitButton>
          </form.AppForm>
        </>
      }
    />
  );
}
