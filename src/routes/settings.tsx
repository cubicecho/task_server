import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Page } from "@/components/app-shell";
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
import {
  SetApiKeyDocument,
  SettingsDocument,
  SettingsToolDiscoveryEnum,
  UpdateSettingsDocument,
} from "@/gql/graphql";
import { request } from "@/lib/gql";

interface Form {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  toolDiscovery: SettingsToolDiscoveryEnum;
  toolSelectModel: string;
}

export function SettingsRoute() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [apiKey, setApiKey] = useState("");

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => request(SettingsDocument) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["settings"] });

  // The row is the source of truth; the form is a copy taken once it has loaded.
  const loaded = settings.data?.settings[0];
  useEffect(() => {
    if (loaded && !form) {
      const { baseUrl, model, systemPrompt, maxTokens, temperature, maxToolIterations } = loaded;
      setForm({
        baseUrl,
        model,
        systemPrompt,
        maxTokens,
        temperature,
        maxToolIterations,
        toolDiscovery: loaded.toolDiscovery,
        toolSelectModel: loaded.toolSelectModel,
      });
    }
  }, [loaded, form]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      // An emptied number input parses to NaN, which would go over the wire as null.
      for (const key of ["maxTokens", "temperature", "maxToolIterations"] as const) {
        if (!Number.isFinite(form[key])) throw new Error(`${key} must be a number.`);
      }
      await request(UpdateSettingsDocument, { set: form });
      // The key travels on its own mutation because it is write-only — it is excluded from
      // the Setting type, so it can never be read back out of the API.
      if (apiKey) await request(SetApiKeyDocument, { apiKey });
      setApiKey("");
    },
    onSuccess: () => {
      toast.success("Settings saved");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const field = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  return (
    <Page
      title="Settings"
      description="The model every task runs on, unless it overrides it."
      actions={
        <Button onClick={() => save.mutate()} disabled={!form || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      }
    >
      <Card className="gap-4 p-4">
        <h2 className="font-medium">Model</h2>
        {form ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                value={form.baseUrl}
                onChange={(event) => field("baseUrl", event.target.value)}
                placeholder="http://localhost:11434/v1"
              />
              <p className="text-xs text-muted-foreground">
                Any OpenAI-compatible server: Ollama <code>:11434/v1</code>, LM Studio{" "}
                <code>:1234/v1</code>, OpenAI, OpenRouter.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="apiKey">API key</Label>
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="unchanged — leave blank to keep the stored key"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="model">Model</Label>
              <ModelSelect
                id="model"
                value={form.model}
                onChange={(model) => field("model", model)}
              />
              <p className="text-xs text-muted-foreground">
                Opening the list asks the server above for its models, so save a new base URL first.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="systemPrompt">Default system prompt</Label>
              <Textarea
                id="systemPrompt"
                rows={3}
                value={form.systemPrompt}
                onChange={(event) => field("systemPrompt", event.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="maxTokens">Max tokens</Label>
                <Input
                  id="maxTokens"
                  type="number"
                  value={form.maxTokens}
                  onChange={(event) => field("maxTokens", Number(event.target.value))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="temperature">Temperature</Label>
                <Input
                  id="temperature"
                  type="number"
                  step="0.1"
                  value={form.temperature}
                  onChange={(event) => field("temperature", Number(event.target.value))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="iterations">Max tool steps</Label>
                <Input
                  id="iterations"
                  type="number"
                  value={form.maxToolIterations}
                  onChange={(event) => field("maxToolIterations", Number(event.target.value))}
                />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </Card>

      {form ? (
        <Card className="gap-4 p-4">
          <h2 className="font-medium">MCP tools</h2>

          <div className="flex flex-col gap-2">
            <Label htmlFor="toolDiscovery">Discovery</Label>
            <Select
              value={form.toolDiscovery}
              onValueChange={(value) => field("toolDiscovery", value as SettingsToolDiscoveryEnum)}
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
            <p className="text-xs text-muted-foreground">
              On demand puts a name-only catalogue in the system prompt and lets the model pull in
              the schemas it needs mid-run. Much cheaper with many tools; costs one extra round trip
              on the runs that use them.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="toolSelectModel">Tool-picking model</Label>
            <ModelSelect
              id="toolSelectModel"
              value={form.toolSelectModel}
              onChange={(model) => field("toolSelectModel", model)}
              defaultLabel="Same model as the task"
            />
            <p className="text-xs text-muted-foreground">
              Guesses which tools a task needs before it starts, so on-demand loading usually costs
              no round trip at all. A small fast model is enough. Unused unless discovery is on
              demand.
            </p>
          </div>
        </Card>
      ) : null}
    </Page>
  );
}
