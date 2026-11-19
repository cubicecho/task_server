import { useMutation } from "@tanstack/react-query";
import { ClipboardPaste } from "lucide-react";
import { useState } from "react";
import {
  CreateMcpServerDocument,
  McpServersLogLevelEnum,
  type McpServersQuery,
  McpServersTransportEnum,
  TestMcpServerDocument,
  UpdateMcpServerDocument,
} from "@/__generated__/graphql/graphql";
import {
  ComboboxField,
  InputField,
  SelectField,
  SwitchField,
  TextareaField,
  useAppForm,
} from "@/components/app-form";
import { DialogLayout } from "@/components/dialog-layout";
import { FieldRow } from "@/components/field-row";
import { FormField } from "@/components/form-field";
import { type McpProbe, McpProbeResult } from "@/components/mcp-probe";
import { Button } from "@/components/ui/button";
import { PlugZap } from "@/components/ui/icons";
import { RadioGroupField } from "@/components/ui/radio-group-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { describeFor } from "@/lib/docs";
import { errorMessage } from "@/lib/errors";
import { request } from "@/lib/gql";
import { parseJson, stringList } from "@/lib/json";
import { fieldProblem, parseMcpJson } from "@/lib/mcp-config";
import { HOOK_PLACEHOLDER, hooksProblem } from "@/lib/mcp-hooks";

type McpServer = McpServersQuery["mcpServers"][number];
type McpTool = McpServersQuery["mcpStatus"][number]["tools"][number];

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
  hiddenTools: string[];
  trustAnnotations: boolean;
  /** Null is the server's own default, which is the column's null. */
  logLevel: McpServersLogLevelEnum | null;
  hooks: string;
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
  hiddenTools: stringList(server?.hiddenTools),
  trustAnnotations: server?.trustAnnotations ?? false,
  // A new server starts where the column does; an existing one's null is kept as null.
  logLevel: server ? (server.logLevel ?? null) : McpServersLogLevelEnum.Warning,
  // Pretty-printed, unlike the one-line fields above: a hook is several keys deep and read more
  // often than it is written.
  hooks: server?.hooks ? JSON.stringify(server.hooks, null, 2) : "",
});

/** A connection field's validator: the pool's own answer, as the field is typed. */
const checks = (field: Parameters<typeof fieldProblem>[0]) => ({
  onChange: ({ value }: { value: string }) => fieldProblem(field, value),
});

export function McpDialog({
  server,
  tools = [],
  onClose,
  onSaved,
}: {
  server?: McpServer;
  /** What the server offers now, for the hidden-tools picker. Empty while it is not connected. */
  tools?: readonly McpTool[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
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
        hiddenTools: draft.hiddenTools.length ? draft.hiddenTools : null,
        trustAnnotations: draft.trustAnnotations,
        logLevel: draft.logLevel,
        hooks: parseJson<unknown>(draft.hooks, "Hooks", null),
      };
      if (server) {
        await request(UpdateMcpServerDocument, { id: server.id, set: values });
      } else {
        await request(CreateMcpServerDocument, { values });
      }
    },
    onSuccess: () => {
      toast(server ? "Server saved" : "Server added", "positive");
      onSaved();
      onClose();
    },
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
  });

  const applyPaste = () => {
    try {
      // Field by field rather than as a whole draft, so the form counts as dirty and the fields
      // the config did not mention keep what was typed into them.
      for (const [key, value] of Object.entries(parseMcpJson(paste))) {
        form.setFieldValue(key as keyof Draft, value as never);
      }
      setPaste("");
      toast("Config applied", "positive");
    } catch (error) {
      toast(errorMessage(error));
    }
  };

  return (
    <DialogLayout
      open
      onOpenChange={(open) => !open && onClose()}
      hasUnsavedChanges={() => !form.state.isDefaultValue}
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
      contentSlot={
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
            <FormField
              label="Paste a config"
              description={
                <>
                  <code>.mcp.json</code> shaped — the whole file, one entry, or just the body.
                </>
              }
              controlSlot={
                <Textarea
                  rows={3}
                  className="font-mono text-xs"
                  value={paste}
                  onChange={(event) => setPaste(event.target.value)}
                  placeholder={
                    '{ "mcpServers": { "fs": { "command": "npx", "args": ["-y", "…"] } } }'
                  }
                />
              }
            />
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={applyPaste}
                disabled={!paste.trim()}
                iconSlot={<ClipboardPaste />}
                content="Apply"
              />
            </div>
          </div>

          <FieldRow
            contentSlot={
              <>
                <InputField
                  form={form}
                  name="slug"
                  label="Slug"
                  description={doc("slug")}
                  required
                  className="font-mono"
                  placeholder="filesystem"
                  validators={checks("slug")}
                />
                <InputField form={form} name="label" label="Label" placeholder="Local files" />
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
                  <InputField
                    form={form}
                    name="command"
                    label="Command"
                    description={doc("command")}
                    required
                    className="font-mono"
                    placeholder="npx"
                    validators={checks("command")}
                  />
                  <InputField
                    form={form}
                    name="args"
                    label="Args"
                    description={doc("args")}
                    className="font-mono text-xs"
                    placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]'
                    validators={checks("args")}
                  />
                  <InputField
                    form={form}
                    name="env"
                    label="Env"
                    description={doc("env")}
                    className="font-mono text-xs"
                    placeholder='{ "API_TOKEN": "…" }'
                    validators={checks("env")}
                  />
                </>
              ) : (
                <>
                  <InputField
                    form={form}
                    name="url"
                    label="URL"
                    description={doc("url")}
                    required
                    className="font-mono"
                    placeholder="https://example.com/mcp"
                    validators={checks("url")}
                  />
                  <InputField
                    form={form}
                    name="headers"
                    label="Headers"
                    description={doc("headers")}
                    className="font-mono text-xs"
                    placeholder='{ "Authorization": "Bearer …" }'
                    validators={checks("headers")}
                  />
                </>
              )
            }
          </form.Subscribe>

          <ComboboxField
            multiple
            form={form}
            name="hiddenTools"
            label="Hidden tools"
            description={doc("hiddenTools")}
            placeholder={tools.length ? "None hidden" : "Connect the server to list its tools"}
            options={tools.map((tool) => ({
              value: tool.name,
              label: tool.name,
              hint: tool.description ?? undefined,
            }))}
            // A server that is not connected lists nothing, and a name can still be typed.
            freeText
            createLabel="Hide"
          />

          <SwitchField
            form={form}
            name="trustAnnotations"
            label="Believe this server's read-only and idempotent hints"
            description={doc("trustAnnotations")}
            orientation="horizontal"
            className="rounded-md border p-3"
          />

          <SelectField
            form={form}
            name="logLevel"
            label="Log level"
            description={doc("logLevel")}
            // In the generated enum's order, which is the column's: quietest first.
            options={Object.values(McpServersLogLevelEnum).map((level) => ({
              value: level,
              label: level,
            }))}
            clearable
            emptyLabel="The server's own default"
          />

          <TextareaField
            form={form}
            name="hooks"
            label="Hooks"
            description={doc("hooks")}
            rows={6}
            className="font-mono text-xs"
            placeholder={HOOK_PLACEHOLDER}
            validators={{ onChange: ({ value }: { value: string }) => hooksProblem(value) }}
          />

          <SwitchField
            form={form}
            name="enabled"
            label="Enabled"
            description={doc("enabled")}
            orientation="horizontal"
            className="rounded-md border p-3"
          />

          {probe ? <McpProbeResult probe={probe} /> : null}
        </form>
      }
      footerSlot={
        <Button
          variant="outline"
          onClick={() => test.mutate()}
          disabled={test.isPending}
          iconSlot={<PlugZap />}
          content={test.isPending ? "Connecting…" : "Test connection"}
        />
      }
      // A function, so Cancel closes through the dialog's own door: `hasUnsavedChanges` guards
      // Escape, the overlay and the X, and a Cancel wired straight to `onClose` was the fourth
      // way out — the one people actually click — going around the ask.
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <form.AppForm>
            {/* Nothing typed is nothing to save — and on a new one it is also the empty row the
                server would refuse. */}
            <form.SubmitButton form="mcp-server" requireChanges />
          </form.AppForm>
        </>
      )}
    />
  );
}
