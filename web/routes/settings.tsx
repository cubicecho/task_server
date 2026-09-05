import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  SetApiKeyDocument,
  SettingsDocument,
  type SettingsQuery,
  SettingsToolDiscoveryEnum,
  UpdateSettingsDocument,
} from "@/__generated__/graphql/graphql";
import { InputField, NumberField, TextareaField, useAppForm } from "@/components/app-form";
import { CardLayout } from "@/components/card-layout";
import { FieldRow } from "@/components/field-row";
import { ModelSelectField } from "@/components/model-select-field";
import { PageLayout } from "@/components/page-layout";
import { PasswordField } from "@/components/password-field";
import { QueryError } from "@/components/query-state";
import { RadioGroupField } from "@/components/radio-group-field";
import { Button } from "@/components/ui/button";
import { describeFor } from "@/lib/docs";
import { request } from "@/lib/gql";
import { useCopy } from "@/lib/use-copy";

/**
 * Where an agent reaches this server.
 *
 * In production express serves the app and the endpoint from one origin, so the page's own is
 * the answer. In dev the app is on vite's port and only `/graphql` is proxied (see
 * `vite.config.ts`), so the endpoint is on the server's own port — the default one, since a
 * page has no way to ask what `PORT` was set to.
 */
const ENDPOINT = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:8787/mcp`
  : `${window.location.origin}/mcp`;

/** What a client wants in its `.mcp.json`, ready to paste. */
const MCP_JSON = `{
  "mcpServers": {
    "tasks": {
      "type": "http",
      "url": "${ENDPOINT}"
    }
  }
}`;

const CLAUDE_CLI = `claude mcp add --transport http tasks ${ENDPOINT}`;

const DESCRIPTION =
  "The model every task runs on, unless the task — or the agent profile it is on — overrides it.";

function Snippet({ label, text }: { label: string; text: string }) {
  const { copied, copy } = useCopy();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">{label}</h3>
        <Button variant="ghost" size="xs" onClick={() => void copy(text)}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">
        <code>{text}</code>
      </pre>
    </div>
  );
}

type SettingsRow = SettingsQuery["settings"][number];

/**
 * The editable half of the row. `id` is deliberately not in here — it is not a field.
 *
 * `apiKey` is: it is a field of this form even though it is not a column anyone can read back,
 * and holding it here rather than in a `useState` beside the form is what makes an unsaved key
 * count as an unsaved change.
 */
interface Form {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  toolDiscovery: SettingsToolDiscoveryEnum;
  toolSelectModel: string;
  requestTimeoutSeconds: number;
  maxRetries: number;
  maxConcurrentRuns: number;
  runRetentionDays: number;
}

const toForm = (row: SettingsRow): Form => ({
  baseUrl: row.baseUrl,
  apiKey: "",
  model: row.model,
  systemPrompt: row.systemPrompt,
  maxTokens: row.maxTokens,
  temperature: row.temperature,
  maxToolIterations: row.maxToolIterations,
  toolDiscovery: row.toolDiscovery,
  toolSelectModel: row.toolSelectModel,
  requestTimeoutSeconds: row.requestTimeoutSeconds,
  maxRetries: row.maxRetries,
  maxConcurrentRuns: row.maxConcurrentRuns,
  runRetentionDays: row.runRetentionDays,
});

/** Every note under a field on this page is the column's own description. */
const doc = describeFor("Setting");

/**
 * An emptied number box parses to null, and every number on this page is required.
 *
 * One validator rather than a check per field, and a check at all rather than the loop over
 * `Object.entries` this used to run at save time: a null went over the wire as a null column,
 * and the message came back as a toast naming a field that was no longer on screen.
 */
const number = {
  onChange: ({ value }: { value: number | null }) =>
    value == null ? "A number is required." : undefined,
};

export function SettingsRoute() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => request(SettingsDocument) });
  const row = settings.data?.settings[0];

  if (!row) {
    return (
      <PageLayout
        title="Settings"
        description={DESCRIPTION}
        width="prose"
        loading={settings.isPending}
        content={
          settings.isError ? (
            <QueryError
              error={settings.error}
              onRetry={() => settings.refetch()}
              what="your settings"
            />
          ) : null
        }
      />
    );
  }

  // The form is built from a row that has already arrived rather than started empty and patched
  // into shape once the query lands, which is what the rest of the app does — see `TaskForm`.
  // Keyed on the row so a background refetch of the same row leaves edits in progress alone.
  return <SettingsForm key={row.id} settings={row} />;
}

function SettingsForm({ settings }: { settings: SettingsRow }) {
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: async ({ apiKey, ...values }: Form) => {
      await request(UpdateSettingsDocument, { set: values });
      // The key travels on its own mutation because it is write-only — it is excluded from
      // the Setting type, so it can never be read back out of the API.
      if (apiKey) await request(SetApiKeyDocument, { apiKey });
    },
    onSuccess: () => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const form = useAppForm({
    defaultValues: toForm(settings),
    onSubmit: async ({ value, formApi }) => {
      await save.mutateAsync(value);
      // The key is not read back, so the box has to be emptied here or it would look stored.
      formApi.reset({ ...value, apiKey: "" });
    },
  });

  return (
    <PageLayout
      title="Settings"
      description={DESCRIPTION}
      width="prose"
      action={
        <form.AppForm>
          <form.SubmitButton form="settings">Save</form.SubmitButton>
        </form.AppForm>
      }
      content={
        <form
          id="settings"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <CardLayout
            title="Model"
            description={
              <>
                An{" "}
                <Link to="/agents" className="underline">
                  agent profile
                </Link>{" "}
                overrides any of this for the tasks pointed at it. Everything a profile leaves blank
                comes from here.
              </>
            }
            content={
              <div className="flex flex-col gap-4">
                <InputField
                  form={form}
                  name="baseUrl"
                  label="Base URL"
                  description={doc("baseUrl")}
                  placeholder="http://localhost:11434/v1"
                />
                <PasswordField
                  form={form}
                  name="apiKey"
                  label="API key"
                  placeholder="unchanged — leave blank to keep the stored key"
                />
                <ModelSelectField
                  form={form}
                  name="model"
                  label="Model"
                  description="Opening the list asks the server above for its models, so save a new base URL first."
                />
                <TextareaField
                  form={form}
                  name="systemPrompt"
                  label="Default system prompt"
                  description={doc("systemPrompt")}
                  rows={3}
                />

                {/* The notes go behind a popover here, not under the boxes: seven of them
                    inline turn a row of three fields into three columns of different heights. */}
                <FieldRow
                  perRow={3}
                  content={
                    <>
                      <NumberField
                        form={form}
                        name="maxTokens"
                        label="Max tokens"
                        description={doc("maxTokens")}
                        descriptionPlacement="popover"
                        validators={number}
                      />
                      <NumberField
                        form={form}
                        name="temperature"
                        label="Temperature"
                        step="0.1"
                        validators={number}
                      />
                      <NumberField
                        form={form}
                        name="maxToolIterations"
                        label="Max tool steps"
                        description={doc("maxToolIterations")}
                        descriptionPlacement="popover"
                        validators={number}
                      />
                      <NumberField
                        form={form}
                        name="requestTimeoutSeconds"
                        label="Silence before giving up (s)"
                        description={doc("requestTimeoutSeconds")}
                        descriptionPlacement="popover"
                        validators={number}
                      />
                      <NumberField
                        form={form}
                        name="maxRetries"
                        label="Retries"
                        description={doc("maxRetries")}
                        descriptionPlacement="popover"
                        validators={number}
                      />
                      <NumberField
                        form={form}
                        name="maxConcurrentRuns"
                        label="Runs at once"
                        description={doc("maxConcurrentRuns")}
                        descriptionPlacement="popover"
                        validators={number}
                      />
                      <NumberField
                        form={form}
                        name="runRetentionDays"
                        label="Keep runs for (days)"
                        description={doc("runRetentionDays")}
                        descriptionPlacement="popover"
                        validators={number}
                      />
                    </>
                  }
                />
              </div>
            }
          />

          <CardLayout
            title="MCP tools"
            content={
              <div className="flex flex-col gap-4">
                <RadioGroupField
                  form={form}
                  name="toolDiscovery"
                  label="Discovery"
                  description={doc("toolDiscovery")}
                  options={[
                    {
                      value: SettingsToolDiscoveryEnum.Eager,
                      label: "Eager",
                      description: "Send every definition every time.",
                    },
                    {
                      value: SettingsToolDiscoveryEnum.Ondemand,
                      label: "On demand",
                      description: "Load definitions as they are needed.",
                    },
                  ]}
                />
                <ModelSelectField
                  form={form}
                  name="toolSelectModel"
                  label="Tool-picking model"
                  description={doc("toolSelectModel")}
                  defaultLabel="Same model as the task"
                />
              </div>
            }
          />

          <CardLayout
            title="Connect an agent"
            description={
              <>
                This server's own API is served as MCP tools at <code>{ENDPOINT}</code>, so an
                assistant elsewhere can list the tasks, add one, run it and watch the run. There is
                no authentication: anyone who can reach the port can do all of that.
              </>
            }
            content={
              <div className="flex flex-col gap-4">
                <Snippet label=".mcp.json" text={MCP_JSON} />
                <Snippet label="Claude Code" text={CLAUDE_CLI} />
              </div>
            }
          />
        </form>
      }
    />
  );
}
