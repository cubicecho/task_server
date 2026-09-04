import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  SetApiKeyDocument,
  SettingsDocument,
  type SettingsQuery,
  SettingsToolDiscoveryEnum,
  UpdateSettingsDocument,
} from "@/__generated__/graphql/graphql";
import { Page } from "@/components/app-shell";
import { Field, NumberField } from "@/components/field";
import { ModelSelect } from "@/components/model-select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

const DESCRIPTION = "The model every task runs on, unless it overrides it.";

function Snippet({ label, text }: { label: string; text: string }) {
  const { copied, copy } = useCopy();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
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

/** The editable half of the row. `id` is deliberately not in here — it is not a field. */
interface Form {
  baseUrl: string;
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

export function SettingsRoute() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => request(SettingsDocument) });
  const row = settings.data?.settings[0];

  if (!row) {
    return (
      <Page title="Settings" description={DESCRIPTION}>
        {settings.error ? (
          <p className="text-sm text-destructive">{(settings.error as Error).message}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </Page>
    );
  }

  // The form is built from a row that has already arrived rather than started empty and patched
  // into shape once the query lands, which is what the rest of the app does — see `TaskForm`.
  // Keyed on the row so a background refetch of the same row leaves edits in progress alone.
  return <SettingsForm key={row.id} settings={row} />;
}

function SettingsForm({ settings }: { settings: SettingsRow }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const [apiKey, setApiKey] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      // An emptied number input parses to NaN, which would go over the wire as null. Asking the
      // values what they are, rather than keeping a list of which fields are numbers, is what
      // stops a field added below from quietly falling outside the check.
      for (const [key, value] of Object.entries(form)) {
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new Error(`${key} must be a number.`);
        }
      }
      await request(UpdateSettingsDocument, { set: form });
      // The key travels on its own mutation because it is write-only — it is excluded from
      // the Setting type, so it can never be read back out of the API.
      if (apiKey) await request(SetApiKeyDocument, { apiKey });
      setApiKey("");
    },
    onSuccess: () => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Page
      title="Settings"
      description={DESCRIPTION}
      actions={
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      }
    >
      <Card className="gap-4 p-4">
        <h2 className="font-medium">Model</h2>

        <Field label="Base URL" htmlFor="baseUrl" hint={doc("baseUrl")}>
          <Input
            id="baseUrl"
            value={form.baseUrl}
            onChange={(event) => set("baseUrl", event.target.value)}
            placeholder="http://localhost:11434/v1"
          />
        </Field>

        <Field label="API key" htmlFor="apiKey">
          <Input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="unchanged — leave blank to keep the stored key"
          />
        </Field>

        <Field
          label="Model"
          htmlFor="model"
          hint={
            <>
              Opening the list asks the server above for its models, so save a new base URL first.
            </>
          }
        >
          <ModelSelect id="model" value={form.model} onChange={(model) => set("model", model)} />
        </Field>

        <Field label="Default system prompt" htmlFor="systemPrompt" hint={doc("systemPrompt")}>
          <Textarea
            id="systemPrompt"
            rows={3}
            value={form.systemPrompt}
            onChange={(event) => set("systemPrompt", event.target.value)}
          />
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <NumberField
            id="maxTokens"
            label="Max tokens"
            hint={doc("maxTokens")}
            value={form.maxTokens}
            onChange={(value) => set("maxTokens", value)}
          />
          <NumberField
            id="temperature"
            label="Temperature"
            step="0.1"
            value={form.temperature}
            onChange={(value) => set("temperature", value)}
          />
          <NumberField
            id="iterations"
            label="Max tool steps"
            hint={doc("maxToolIterations")}
            value={form.maxToolIterations}
            onChange={(value) => set("maxToolIterations", value)}
          />
          <NumberField
            id="requestTimeoutSeconds"
            label="Silence before giving up (s)"
            hint={doc("requestTimeoutSeconds")}
            value={form.requestTimeoutSeconds}
            onChange={(value) => set("requestTimeoutSeconds", value)}
          />
          <NumberField
            id="maxRetries"
            label="Retries"
            hint={doc("maxRetries")}
            value={form.maxRetries}
            onChange={(value) => set("maxRetries", value)}
          />
          <NumberField
            id="maxConcurrentRuns"
            label="Runs at once"
            hint={doc("maxConcurrentRuns")}
            value={form.maxConcurrentRuns}
            onChange={(value) => set("maxConcurrentRuns", value)}
          />
          <NumberField
            id="runRetentionDays"
            label="Keep runs for (days)"
            hint={doc("runRetentionDays")}
            value={form.runRetentionDays}
            onChange={(value) => set("runRetentionDays", value)}
          />
        </div>
      </Card>

      <Card className="gap-4 p-4">
        <h2 className="font-medium">MCP tools</h2>

        <Field label="Discovery" htmlFor="toolDiscovery" hint={doc("toolDiscovery")}>
          <Select
            value={form.toolDiscovery}
            onValueChange={(value) => set("toolDiscovery", value as SettingsToolDiscoveryEnum)}
          >
            <SelectTrigger id="toolDiscovery" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SettingsToolDiscoveryEnum.Eager}>
                Eager — send every definition every time
              </SelectItem>
              <SelectItem value={SettingsToolDiscoveryEnum.Ondemand}>
                On demand — load definitions as needed
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Tool-picking model" htmlFor="toolSelectModel" hint={doc("toolSelectModel")}>
          <ModelSelect
            id="toolSelectModel"
            value={form.toolSelectModel}
            onChange={(model) => set("toolSelectModel", model)}
            defaultLabel="Same model as the task"
          />
        </Field>
      </Card>

      <Card className="gap-4 p-4">
        <div>
          <h2 className="font-medium">Connect an agent</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This server's own API is served as MCP tools at <code>{ENDPOINT}</code>, so an assistant
            elsewhere can list the tasks, add one, run it and watch the run. There is no
            authentication: anyone who can reach the port can do all of that.
          </p>
        </div>

        <Snippet label=".mcp.json" text={MCP_JSON} />
        <Snippet label="Claude Code" text={CLAUDE_CLI} />
      </Card>
    </Page>
  );
}
