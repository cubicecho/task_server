import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Page } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ModelsDocument,
  SetApiKeyDocument,
  SettingsDocument,
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
      setForm({ baseUrl, model, systemPrompt, maxTokens, temperature, maxToolIterations });
    }
  }, [loaded, form]);

  // Only fetched on demand: it is a live call to whatever server baseUrl points at, which may
  // not be running.
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => request(ModelsDocument),
    enabled: false,
  });

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
              <div className="flex items-center justify-between">
                <Label htmlFor="model">Model</Label>
                <Button variant="ghost" size="sm" onClick={() => models.refetch()}>
                  <RefreshCw className="size-4" />
                  List models
                </Button>
              </div>
              <Input
                id="model"
                list="model-options"
                value={form.model}
                onChange={(event) => field("model", event.target.value)}
                placeholder="llama3.1:8b"
              />
              <datalist id="model-options">
                {models.data?.models.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {models.error ? (
                <p className="text-xs text-destructive">{(models.error as Error).message}</p>
              ) : null}
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
    </Page>
  );
}
