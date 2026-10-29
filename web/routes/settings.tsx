import { useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import {
  ModelsDocument,
  SetApiKeyDocument,
  SettingsDocument,
  type SettingsFieldsFragment,
  type SettingsQuery,
  SettingsToolDiscoveryEnum,
  SettingsToolExecutionEnum,
  UpdateSettingsDocument,
} from "@/__generated__/graphql/graphql";
import { InputField, NumberField, TextareaField, useAppForm } from "@/components/app-form";
import { FieldRow } from "@/components/field-row";
import { ModelSelectField } from "@/components/model-select-field";
import { PageLayout } from "@/components/page-layout";
import { PasswordField } from "@/components/password-field";
import { QueryError } from "@/components/query-state";
import { RadioGroupField } from "@/components/radio-group-field";
import { Section } from "@/components/section";
import { SettingsTabList, SettingsTabsRoot } from "@/components/settings-tabs";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code";
import { CopyButton } from "@/components/ui/copy-button";
import { CircleCheck } from "@/components/ui/icons";
import { TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { describeFor } from "@/lib/docs";
import { request } from "@/lib/gql";
import { dirtySections, type SettingsForm, sectionLabel, toForm, toRow } from "@/lib/settings-form";

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
  const toast = useToast();

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="font-medium text-sm">{label}</h3>
      <CodeBlock
        content={text}
        actionSlot={
          <CopyButton
            value={text}
            label={`Copy the ${label} snippet`}
            onError={() => toast("Could not copy. Select the text and copy it by hand.")}
          />
        }
      />
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

/** An `integer` field stores a fraction as `null` too, so the one message has to cover both. */
const wholeNumber = {
  onChange: ({ value }: { value: number | null }) =>
    value == null ? "A whole number is required." : undefined,
};

/** What the endpoint button says: mid-flight, about to change the endpoint, or just asking again. */
function endpointAction(connecting: boolean, unapplied: boolean): string {
  if (connecting) {
    return "Connecting…";
  }
  return unapplied ? "Apply and load models" : "Reload models";
}

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
        headerContentSlot={<SettingsTabsRoot current="model" contentSlot={<SettingsTabList />} />}
        loading={settings.isPending}
        contentSlot={
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
  const toast = useToast();
  const queryClient = useQueryClient();
  const { tab = "model" } = useSearch({ from: "/settings" });
  const [probe, setProbe] = useState<Probe>(null);

  /** What was written becomes the row this page is a copy of, without waiting on a refetch. */
  const store = (fresh: SettingsFieldsFragment) =>
    queryClient.setQueryData<SettingsQuery>(["settings"], { settings: [fresh] });

  const save = useMutation({
    mutationFn: async (values: SettingsForm) => {
      const { updateSetting } = await request(UpdateSettingsDocument, { set: toRow(values) });
      // The key travels on its own mutation because it is write-only — it is excluded from
      // the Setting type, so it can never be read back out of the API.
      if (values.apiKey) {
        await request(SetApiKeyDocument, { apiKey: values.apiKey });
      }
      if (!updateSetting) {
        throw new Error("There is no settings row to save to.");
      }
      return updateSetting;
    },
    onSuccess: (fresh) => {
      // Reseeded from what the save read back. Left to a refetch, the form spent the gap being
      // compared against the row as it was before the save, and said the changes it had just
      // written were still unsaved.
      form.reset(toForm(fresh));
      store(fresh);
      // A model list belongs to an endpoint, and profiles that inherit this one inherit its list.
      queryClient.invalidateQueries({ queryKey: ["models"] });
      toast("Settings saved", "positive");
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
      const { updateSetting } = await request(UpdateSettingsDocument, { set: { baseUrl } });
      if (apiKey) {
        await request(SetApiKeyDocument, { apiKey });
      }
      if (updateSetting) {
        store(updateSetting);
      }
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
    meta: { quiet: true },
    onError: (error) => setProbe({ ok: false, detail: error.message }),
  });

  const endpointPending = values.baseUrl !== row.baseUrl || Boolean(values.apiKey);

  // In the header, where the task editor keeps its Save, so it is in reach from every tab. The
  // dot on each tab says which panels the unsaved changes are on.
  const actions = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        disabled={save.isPending || dirty.length === 0}
        hint={dirty.length > 0 ? `Unsaved: ${dirty.map(sectionLabel).join(", ")}` : undefined}
        onClick={() => {
          form.reset(toForm(row));
          setProbe(null);
        }}
        content="Revert"
      />
      <form.AppForm>
        <form.SubmitButton variant="positive" form={FORM_ID} disabled={dirty.length === 0} />
      </form.AppForm>
    </div>
  );

  const panel = "flex flex-col gap-6 data-[state=inactive]:hidden";

  return (
    <SettingsTabsRoot
      current={tab}
      contentSlot={
        <PageLayout
          title={TITLE}
          description={DESCRIPTION}
          headerContentSlot={<SettingsTabList dirty={dirty} />}
          actionSlot={actions}
          contentSlot={
            <>
              <form
                id={FORM_ID}
                onSubmit={(event) => {
                  event.preventDefault();
                  form.handleSubmit();
                }}
              >
                <TabsContent value="model" forceMount className={panel}>
                  <Section
                    title="Endpoint"
                    description={
                      <>
                        Every task uses this one unless its{" "}
                        <Link to="/settings/agents" className="underline">
                          agent profile
                        </Link>{" "}
                        names an endpoint of its own.
                      </>
                    }
                    contentSlot={
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
                              applyEndpoint.mutate({
                                baseUrl: values.baseUrl,
                                apiKey: values.apiKey,
                              })
                            }
                            content={endpointAction(applyEndpoint.isPending, endpointPending)}
                          />
                          {endpointPending ? (
                            <p className="text-xs text-foreground/60">
                              Not applied yet — the model lists are still the stored endpoint's.
                            </p>
                          ) : null}
                        </div>

                        {probe ? (
                          <Alert
                            variant={probe.ok ? "default" : "destructive"}
                            iconSlot={probe.ok ? <CircleCheck /> : undefined}
                            title={probe.ok ? `Connected — ${probe.detail}` : "Could not connect"}
                            description={
                              probe.ok ? undefined : (
                                <span className="whitespace-pre-wrap font-mono text-xs">
                                  {probe.detail}
                                </span>
                              )
                            }
                          />
                        ) : null}
                      </div>
                    }
                  />

                  <Section
                    title="Model"
                    contentSlot={
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
                  <Section
                    title="Limits"
                    description="What one run may spend."
                    contentSlot={
                      <FieldRow
                        perRow={3}
                        contentSlot={
                          <>
                            <NumberField
                              form={form}
                              name="maxTokens"
                              label="Max tokens"
                              description={doc("maxTokens")}
                              integer
                              validators={wholeNumber}
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
                              integer
                              validators={wholeNumber}
                            />
                          </>
                        }
                      />
                    }
                  />

                  <Section
                    title="Resilience"
                    description="What a request does when the endpoint goes quiet or falls over."
                    contentSlot={
                      <FieldRow
                        contentSlot={
                          <>
                            <NumberField
                              form={form}
                              name="requestTimeoutSeconds"
                              label="Silence before giving up (s)"
                              description={doc("requestTimeoutSeconds")}
                              integer
                              validators={wholeNumber}
                            />
                            <NumberField
                              form={form}
                              name="maxRetries"
                              label="Retries"
                              description={doc("maxRetries")}
                              integer
                              validators={wholeNumber}
                            />
                          </>
                        }
                      />
                    }
                  />

                  <Section
                    title="Context"
                    description="What a run does when it fills the model's context window."
                    contentSlot={
                      <ModelSelectField
                        form={form}
                        name="compactionModel"
                        label="Compaction model"
                        description={doc("compactionModel")}
                        defaultLabel="Off"
                      />
                    }
                  />
                </TabsContent>

                <TabsContent value="tools" forceMount className={panel}>
                  <Section
                    title="MCP tools"
                    contentSlot={
                      <div className="flex flex-col gap-4">
                        <RadioGroupField
                          form={form}
                          name="toolDiscovery"
                          label="Tool discovery"
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
                              description: "Load definitions as the run asks for them.",
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
                        <RadioGroupField
                          form={form}
                          name="toolExecution"
                          label="Tool calls in one reply"
                          description={doc("toolExecution")}
                          options={[
                            {
                              value: SettingsToolExecutionEnum.Sequential,
                              label: "One at a time",
                              description: "Each call waits for the one before it.",
                            },
                            {
                              value: SettingsToolExecutionEnum.Parallel,
                              label: "All at once",
                              description: "For tools that only read.",
                            },
                          ]}
                        />
                      </div>
                    }
                  />
                </TabsContent>

                <TabsContent value="server" forceMount className={panel}>
                  <Section
                    title="Housekeeping"
                    description="What this process does on its own, with no trigger asking."
                    contentSlot={
                      <FieldRow
                        contentSlot={
                          <>
                            <NumberField
                              form={form}
                              name="maxConcurrentRuns"
                              label="Runs at once"
                              description={doc("maxConcurrentRuns")}
                              integer
                              validators={wholeNumber}
                            />
                            <NumberField
                              form={form}
                              name="runRetentionDays"
                              label="Keep runs for (days)"
                              description={doc("runRetentionDays")}
                              integer
                              validators={wholeNumber}
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
                <Section
                  title="Connect an agent"
                  description={
                    <>
                      This server's own API is served as MCP tools at <code>{ENDPOINT}</code>, so an
                      assistant elsewhere can list the tasks, add one, run it and watch the run.
                      There is no authentication: anyone who can reach the port can do all of that.
                    </>
                  }
                  contentSlot={
                    <div className="flex flex-col gap-4">
                      <Snippet label=".mcp.json" text={MCP_JSON} />
                      <Snippet label="Claude Code" text={CLAUDE_CLI} />
                    </div>
                  }
                />
              </TabsContent>
            </>
          }
        />
      }
    />
  );
}
