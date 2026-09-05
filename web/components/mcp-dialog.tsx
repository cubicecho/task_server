import { useMutation } from "@tanstack/react-query";
import { ClipboardPaste, PlugZap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  CreateMcpServerDocument,
  type McpProbe,
  type McpServersQuery,
  McpServersTransportEnum,
  TestMcpServerDocument,
  UpdateMcpServerDocument,
} from "@/__generated__/graphql/graphql";
import { useAppForm } from "@/components/app-form";
import { DialogLayout } from "@/components/dialog-layout";
import { FieldRow } from "@/components/field-row";
import { McpProbeResult } from "@/components/mcp-probe";
import { RadioGroupField } from "@/components/radio-group-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { describeFor } from "@/lib/docs";
import { request } from "@/lib/gql";
import { parseJson } from "@/lib/json";
import { parseMcpJson } from "@/lib/mcp-config";

type McpServer = McpServersQuery["mcpServers"][number];

/** The form's own shape: JSON columns are edited as text, so a half-typed object is allowed. */
interface Draft {
  slug: string;
  label: string;
  enabled: boolean;
  transport: McpServersTransportEnum;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

/** The notes under this form's fields are the columns' own descriptions. */
const doc = describeFor("McpServer");

const json = (value: unknown, fallback: string) =>
  value === null || value === undefined ? fallback : JSON.stringify(value);

const toDraft = (server?: McpServer): Draft => ({
  slug: server?.slug ?? "",
  label: server?.label ?? "",
  enabled: server?.enabled ?? true,
  transport: server?.transport ?? McpServersTransportEnum.Stdio,
  command: server?.command ?? "",
  args: json(server?.args, "[]"),
  env: json(server?.env, "{}"),
  url: server?.url ?? "",
  headers: json(server?.headers, "{}"),
});

/**
 * A field that has to parse, checked as it is typed.
 *
 * These three columns are jsonb and are edited here as text, so the only moment the text is
 * known to be an object is when something parses it. That used to be `save`, which meant a
 * missing bracket was a toast on the way out naming a field that was no longer on screen.
 */
const parses = (what: string, fallback: unknown) => ({
  onChange: ({ value }: { value: string }) => {
    try {
      parseJson(value, what, fallback);
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  },
});

const required = (what: string) => ({
  onChange: ({ value }: { value: string }) => (value.trim() ? undefined : what),
});

export function McpDialog({
  server,
  onClose,
  onSaved,
}: {
  server?: McpServer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [paste, setPaste] = useState("");
  const [probe, setProbe] = useState<McpProbe | null>(null);

  /** The connection half of a draft, as the API wants it. */
  const connection = (draft: Draft) => ({
    transport: draft.transport,
    command: draft.command.trim(),
    args: parseJson<string[]>(draft.args, "Args", []),
    env: parseJson<Record<string, string>>(draft.env, "Env", {}),
    url: draft.url.trim(),
    headers: parseJson<Record<string, string>>(draft.headers, "Headers", {}),
  });

  const save = useMutation({
    mutationFn: async (draft: Draft) => {
      const values = {
        ...connection(draft),
        slug: draft.slug.trim(),
        label: draft.label.trim(),
        enabled: draft.enabled,
      };
      if (server) await request(UpdateMcpServerDocument, { id: server.id, set: values });
      else await request(CreateMcpServerDocument, { values });
    },
    onSuccess: () => {
      toast.success(server ? "Server saved" : "Server added");
      onSaved();
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const form = useAppForm({
    defaultValues: toDraft(server),
    onSubmit: ({ value }) => save.mutateAsync(value),
  });

  const test = useMutation({
    mutationFn: async () => {
      setProbe(null);
      const { testMcpServer } = await request(TestMcpServerDocument, {
        config: connection(form.state.values),
      });
      return testMcpServer;
    },
    onSuccess: setProbe,
    onError: (error: Error) => toast.error(error.message),
  });

  const applyPaste = () => {
    try {
      // Field by field rather than as a whole draft, so the form counts as dirty and the fields
      // the config did not mention keep what was typed into them.
      for (const [key, value] of Object.entries(parseMcpJson(paste))) {
        form.setFieldValue(key as keyof Draft, value as never);
      }
      setPaste("");
      toast.success("Config applied");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <DialogLayout
      open
      onOpenChange={(open) => !open && onClose()}
      hasUnsavedChanges={form.state.isDirty}
      size="lg"
      title={server ? "Edit server" : "New MCP server"}
      description={
        <form.Subscribe selector={(state) => state.values.slug}>
          {(slug) => (
            <>
              Its tools reach every task as <code>{slug || "slug"}__tool-name</code>.
            </>
          )}
        </form.Subscribe>
      }
      content={
        <form
          id="mcp-server"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          {/* Not a form field: it is a way of filling several of them in, and nothing here is
              saved. Most servers arrive as a block of JSON from a README, and typing that out
              again by hand is four fields' worth of chances to get one wrong. */}
          <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
            <Label htmlFor="mcp-paste">Paste a config</Label>
            <Textarea
              id="mcp-paste"
              rows={3}
              className="font-mono text-xs"
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              placeholder={'{ "mcpServers": { "fs": { "command": "npx", "args": ["-y", "…"] } } }'}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                <code>.mcp.json</code> shaped — the whole file, one entry, or just the body.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={applyPaste}
                disabled={!paste.trim()}
              >
                <ClipboardPaste className="size-4" />
                Apply
              </Button>
            </div>
          </div>

          <FieldRow
            content={
              <>
                <form.AppField
                  name="slug"
                  validators={required("A server needs a slug — its tools are named after it.")}
                >
                  {(field) => (
                    <field.InputField
                      label="Slug"
                      description={doc("slug")}
                      required
                      className="font-mono"
                      placeholder="filesystem"
                    />
                  )}
                </form.AppField>
                <form.AppField name="label">
                  {(field) => <field.InputField label="Label" placeholder="Local files" />}
                </form.AppField>
              </>
            }
          />

          <RadioGroupField
            form={form}
            name="transport"
            label="Transport"
            description={doc("transport")}
            options={[
              {
                value: McpServersTransportEnum.Stdio,
                label: "stdio",
                description: "Run a local command and talk to it over its own pipes.",
              },
              {
                value: McpServersTransportEnum.Http,
                label: "http",
                description: "Connect to a server that is already running, at a URL.",
              },
            ]}
          />

          <form.Subscribe selector={(state) => state.values.transport}>
            {(transport) =>
              transport === McpServersTransportEnum.Stdio ? (
                <>
                  <form.AppField
                    name="command"
                    validators={required("A stdio server needs a command.")}
                  >
                    {(field) => (
                      <field.InputField
                        label="Command"
                        description={doc("command")}
                        required
                        className="font-mono"
                        placeholder="npx"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="args" validators={parses("Args", [])}>
                    {(field) => (
                      <field.InputField
                        label="Args"
                        description={doc("args")}
                        className="font-mono text-xs"
                        placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]'
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="env" validators={parses("Env", {})}>
                    {(field) => (
                      <field.InputField
                        label="Env"
                        description={doc("env")}
                        className="font-mono text-xs"
                        placeholder='{ "API_TOKEN": "…" }'
                      />
                    )}
                  </form.AppField>
                </>
              ) : (
                <>
                  <form.AppField name="url" validators={required("An http server needs a url.")}>
                    {(field) => (
                      <field.InputField
                        label="URL"
                        description={doc("url")}
                        required
                        className="font-mono"
                        placeholder="https://example.com/mcp"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="headers" validators={parses("Headers", {})}>
                    {(field) => (
                      <field.InputField
                        label="Headers"
                        description={doc("headers")}
                        className="font-mono text-xs"
                        placeholder='{ "Authorization": "Bearer …" }'
                      />
                    )}
                  </form.AppField>
                </>
              )
            }
          </form.Subscribe>

          <form.AppField name="enabled">
            {(field) => (
              <field.SwitchField
                label="Enabled"
                description="A disabled server stays configured but offers no tools."
                orientation="horizontal"
                className="rounded-md border p-3"
              />
            )}
          </form.AppField>

          {probe ? <McpProbeResult probe={probe} /> : null}
        </form>
      }
      footer={
        <Button
          type="button"
          variant="secondary"
          onClick={() => test.mutate()}
          disabled={test.isPending}
        >
          <PlugZap className="size-4" />
          {test.isPending ? "Connecting…" : "Test connection"}
        </Button>
      }
      footerActions={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton form="mcp-server">Save</form.SubmitButton>
          </form.AppForm>
        </>
      }
    />
  );
}
