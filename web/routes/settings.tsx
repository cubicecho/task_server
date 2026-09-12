import { useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Check, CheckCircle2, Copy, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ModelsDocument,
  SetApiKeyDocument,
  SettingsDocument,
  type SettingsFieldsFragment,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeFor } from "@/lib/docs";
import { request } from "@/lib/gql";
import {
  dirtySections,
  SETTINGS_SECTIONS,
  type SettingsForm,
  type SettingsSection,
  sectionLabel,
  toForm,
  toRow,
} from "@/lib/settings-form";
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

const TITLE = "Settings";
const DESCRIPTION =
  "What every task falls back to for anything it — or the agent profile it is on — does not set itself.";

/** The id the Save button in the footer submits, being outside the form it saves. */
const FORM_ID = "settings";

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

/** Every note under a field on this page is the column's own description. */
const doc = describeFor("Setting");

/**
 * An emptied number box parses to null, and every number on this page is required.
 *
 * One validator rather than a check per field, and a check at all rather than a loop at save
 * time: a null went over the wire as a null column, and the message came back as a toast naming
 * a field that was no longer on screen.
 */
const number = {
  onChange: ({ value }: { value: number | null }) =>
    value == null ? "A number is required." : undefined,
};

/** How the endpoint button last went: what the server answered, or why it did not. */
type Probe = { ok: boolean; detail: string } | null;

export function SettingsRoute() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => request(SettingsDocument) });
  const row = settings.data?.settings[0];

  if (!row) {
    return (
      <PageLayout
        title={TITLE}
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
  return <SettingsEditor row={row} />;
}

/**
 * The one settings row, behind the panels that edit parts of it.
 *
 * There is one draft and the panels are field groups over it: from the row's point of view there
 * is no saving only the Tools half, so the bar under the page writes the whole row and says which
 * panels the unsaved changes are on. Every panel stays mounted and is only hidden, so a value
 * typed on one tab is still there, and still counted, when you are on another.
 */
function SettingsEditor({ row }: { row: SettingsFieldsFragment }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { tab = "model" } = useSearch({ from: "/settings" });
  const [probe, setProbe] = useState<Probe>(null);

  /** What was written becomes the row this page is a copy of, without waiting on a refetch. */
  const store = (fresh: SettingsFieldsFragment) =>
    queryClient.setQueryData<SettingsQuery>(["settings"], { settings: [fresh] });

  const save = useMutation({
    mutationFn: async (values: SettingsForm) => {
      const { updateSettingSingle } = await request(UpdateSettingsDocument, { set: toRow(values) });
      // The key travels on its own mutation because it is write-only — it is excluded from
      // the Setting type, so it can never be read back out of the API.
      if (values.apiKey) await request(SetApiKeyDocument, { apiKey: values.apiKey });
      if (!updateSettingSingle) throw new Error("There is no settings row to save to.");
      return updateSettingSingle;
    },
    onSuccess: (fresh) => {
      // Reseeded from what the save read back. Left to a refetch, the form spent the gap being
      // compared against the row as it was before the save, and said the changes it had just
      // written were still unsaved.
      form.reset(toForm(fresh));
      store(fresh);
      // A model list belongs to an endpoint, and profiles that inherit this one inherit its list.
      queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success("Settings saved");
    },
  });

  const form = useAppForm({
    // Derived from the row on every render rather than held: while nothing is touched, a row
    // that changes underneath — a refetch, a save — reseeds the form; once something is, it is
    // left alone.
    defaultValues: toForm(row),
    onSubmit: ({ value }) => save.mutateAsync(value),
  });

  const values = useStore(form.store, (state) => state.values);
  const dirty = dirtySections(values, row);

  /**
   * Store just the endpoint, then ask it what it serves.
   *
   * The model pickers list what the *stored* endpoint reports, so until a typed base URL is
   * saved there is nothing behind them but the last server's answers. A patch rather than a
   * whole save, because "point at this server" should not also commit a half-written prompt
   * two tabs away — and for the same reason nothing else in the form is reseeded.
   */
  const applyEndpoint = useMutation({
    mutationFn: async ({ baseUrl, apiKey }: Pick<SettingsForm, "baseUrl" | "apiKey">) => {
      const { updateSettingSingle } = await request(UpdateSettingsDocument, { set: { baseUrl } });
      if (apiKey) await request(SetApiKeyDocument, { apiKey });
      if (updateSettingSingle) store(updateSettingSingle);
      form.setFieldValue("apiKey", "");
      await queryClient.invalidateQueries({ queryKey: ["models"], refetchType: "none" });
      const { models } = await queryClient.fetchQuery({
        queryKey: ["models", ""],
        queryFn: () => request(ModelsDocument, { agentId: null }),
        retry: false,
      });
      return `${baseUrl || "the default endpoint"} — ${models.length} model(s)`;
    },
    onMutate: () => setProbe(null),
    onSuccess: (detail) => setProbe({ ok: true, detail }),
    // The probe line is the answer, so the global toast would only say it twice.
    onError: (error) => setProbe({ ok: false, detail: error.message }),
  });

  const endpointPending = values.baseUrl !== row.baseUrl || Boolean(values.apiKey);

  const open = (next: string) =>
    navigate({ to: "/settings", search: { tab: next as SettingsSection }, replace: true });

  // Pinned under the scroller, and only there when there is something to do with it: the page
  // is panels long, and a Save past the end of one of them is a Save you scroll to.
  const bar =
    dirty.length > 0 ? (
      <div className="flex flex-wrap items-center gap-3 py-3">
        <p className="flex-1 text-sm text-muted-foreground">
          Unsaved changes on {dirty.map(sectionLabel).join(", ")}
        </p>
        <Button
          variant="ghost"
          disabled={save.isPending}
          onClick={() => {
            form.reset(toForm(row));
            setProbe(null);
          }}
        >
          Revert
        </Button>
        <form.AppForm>
          <form.SubmitButton form={FORM_ID} />
        </form.AppForm>
      </div>
    ) : null;

  const panel = "flex flex-col gap-4 data-[state=inactive]:hidden";

  return (
    <PageLayout
      title={TITLE}
      description={DESCRIPTION}
      width="prose"
      footer={bar}
      footerClassName="border-t"
      content={
        <Tabs value={tab} onValueChange={open}>
          <div className="max-w-full overflow-x-auto">
            <TabsList>
              {SETTINGS_SECTIONS.map((section) => (
                <TabsTrigger key={section.key} value={section.key}>
                  {section.label}
                  {dirty.includes(section.key) ? (
                    <>
                      <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                      <span className="sr-only">(unsaved changes)</span>
                    </>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <form
            id={FORM_ID}
            onSubmit={(event) => {
              event.preventDefault();
              form.handleSubmit();
            }}
          >
            <TabsContent value="model" forceMount className={panel}>
              <CardLayout
                title="Endpoint"
                description={
                  <>
                    Every task uses this one unless its{" "}
                    <Link to="/agents" className="underline">
                      agent profile
                    </Link>{" "}
                    names an endpoint of its own.
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
                      autoComplete="off"
                    />
                    <PasswordField
                      form={form}
                      name="apiKey"
                      label="API key"
                      autoComplete="new-password"
                      placeholder="unchanged — leave blank to keep the stored key"
                    />

                    {/* Its own button rather than the bar's job, because these are the two
                        fields something else on the page depends on: the model pickers ask the
                        stored endpoint, not the one in the boxes. */}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        disabled={applyEndpoint.isPending}
                        onClick={() =>
                          applyEndpoint.mutate({ baseUrl: values.baseUrl, apiKey: values.apiKey })
                        }
                      >
                        {applyEndpoint.isPending
                          ? "Connecting…"
                          : endpointPending
                            ? "Apply and load models"
                            : "Reload models"}
                      </Button>
                      {endpointPending ? (
                        <p className="text-xs text-muted-foreground">
                          Not applied yet — the model lists are still the stored endpoint's.
                        </p>
                      ) : null}
                    </div>

                    {probe ? (
                      <div className="flex items-start gap-2 text-sm">
                        {probe.ok ? (
                          <CheckCircle2
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        ) : (
                          <XCircle
                            className="mt-0.5 size-4 shrink-0 text-destructive"
                            aria-hidden
                          />
                        )}
                        <p
                          className={
                            probe.ok
                              ? "text-muted-foreground"
                              : "whitespace-pre-wrap font-mono text-xs text-destructive"
                          }
                        >
                          {probe.ok ? `Connected — ${probe.detail}` : probe.detail}
                        </p>
                      </div>
                    ) : null}
                  </div>
                }
              />

              <CardLayout
                title="Model"
                content={
                  <div className="flex flex-col gap-4">
                    <ModelSelectField
                      form={form}
                      name="model"
                      label="Default model"
                      description={doc("model")}
                    />
                    <TextareaField
                      form={form}
                      name="systemPrompt"
                      label="Default system prompt"
                      description={doc("systemPrompt")}
                      rows={3}
                    />
                  </div>
                }
              />
            </TabsContent>

            <TabsContent value="limits" forceMount className={panel}>
              <CardLayout
                title="Limits"
                description="What one run may spend."
                content={
                  <FieldRow
                    perRow={3}
                    content={
                      <>
                        <NumberField
                          form={form}
                          name="maxTokens"
                          label="Max tokens"
                          description={doc("maxTokens")}
                          validators={number}
                        />
                        <NumberField
                          form={form}
                          name="temperature"
                          label="Temperature"
                          description={doc("temperature")}
                          step="0.1"
                          validators={number}
                        />
                        <NumberField
                          form={form}
                          name="maxToolIterations"
                          label="Max tool steps"
                          description={doc("maxToolIterations")}
                          validators={number}
                        />
                      </>
                    }
                  />
                }
              />

              <CardLayout
                title="Resilience"
                description="What a request does when the endpoint goes quiet or falls over."
                content={
                  <FieldRow
                    content={
                      <>
                        <NumberField
                          form={form}
                          name="requestTimeoutSeconds"
                          label="Silence before giving up (s)"
                          description={doc("requestTimeoutSeconds")}
                          validators={number}
                        />
                        <NumberField
                          form={form}
                          name="maxRetries"
                          label="Retries"
                          description={doc("maxRetries")}
                          validators={number}
                        />
                      </>
                    }
                  />
                }
              />
            </TabsContent>

            <TabsContent value="tools" forceMount className={panel}>
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
            </TabsContent>

            <TabsContent value="server" forceMount className={panel}>
              <CardLayout
                title="Housekeeping"
                description="What this process does on its own, with no trigger asking."
                content={
                  <FieldRow
                    content={
                      <>
                        <NumberField
                          form={form}
                          name="maxConcurrentRuns"
                          label="Runs at once"
                          description={doc("maxConcurrentRuns")}
                          validators={number}
                        />
                        <NumberField
                          form={form}
                          name="runRetentionDays"
                          label="Keep runs for (days)"
                          description={doc("runRetentionDays")}
                          validators={number}
                        />
                      </>
                    }
                  />
                }
              />
            </TabsContent>
          </form>

          {/* Outside the form: it edits nothing, and a button inside one is a submit. */}
          <TabsContent value="connect" forceMount className={panel}>
            <CardLayout
              title="Connect an agent"
              description={
                <>
                  This server's own API is served as MCP tools at <code>{ENDPOINT}</code>, so an
                  assistant elsewhere can list the tasks, add one, run it and watch the run. There
                  is no authentication: anyone who can reach the port can do all of that.
                </>
              }
              content={
                <div className="flex flex-col gap-4">
                  <Snippet label=".mcp.json" text={MCP_JSON} />
                  <Snippet label="Claude Code" text={CLAUDE_CLI} />
                </div>
              }
            />
          </TabsContent>
        </Tabs>
      }
    />
  );
}
