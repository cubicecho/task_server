import { useStore } from "@tanstack/react-form";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { FileUp, ScanSearch } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AgentSpecPreviewDocument,
  type AgentSpecPreviewQuery,
  ImportAgentSpecDocument,
} from "@/__generated__/graphql/graphql";
import { CheckboxField, InputField, TextareaField, useAppForm } from "@/components/app-form";
import { DialogLayout } from "@/components/dialog-layout";
import { QueryError } from "@/components/query-state";
import { Section } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { initialTicks, mayImport, overrides, readSpec, tickedSlugs } from "@/lib/agent-spec";
import { request } from "@/lib/gql";

type Preview = AgentSpecPreviewQuery["agentSpecPreview"];
type Bundled = Preview["bundled"][number];

/**
 * A document that has been read, and the text it was read from.
 *
 * The text is kept beside it because the box stays editable: a preview is an answer about one
 * document, and the moment the box says something else there is nothing on screen to import.
 */
interface Read {
  text: string;
  document: unknown;
  bundled: Bundled[];
}

interface Draft {
  text: string;
  name: string;
  /** One tick per bundled server, in the document's order. */
  create: boolean[];
}

/** What a list of the server's own sentences looks like, three times over. */
function Lines({ lines, tone }: { lines: string[]; tone?: "refusal" }) {
  return (
    <ul
      className={
        tone === "refusal"
          ? "list-disc space-y-1 pl-5 text-destructive text-sm"
          : "list-disc space-y-1 pl-5 text-muted-foreground text-sm"
      }
    >
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** What ticking this server's box would run or dial, and everything else worth reading first. */
function bundledNote(server: Bundled) {
  return (
    <span className="flex flex-col gap-1">
      <code className="break-all">{server.target || "(nothing to run)"}</code>
      {server.exists ? (
        <span>
          Already a server here. Left unticked, the profile uses the one that exists; an import does
          not overwrite it.
        </span>
      ) : null}
      {server.envNames.length ? <span>Sets env: {server.envNames.join(", ")}</span> : null}
      {server.headerNames.length ? (
        <span>Sets headers: {server.headerNames.join(", ")}</span>
      ) : null}
      {server.problems.map((problem) => (
        <span key={problem} className="text-destructive">
          {problem}
        </span>
      ))}
      {server.notes.map((note) => (
        <span key={note}>{note}</span>
      ))}
    </span>
  );
}

/**
 * Importing a profile from an agent spec: paste or choose, read what it would do, then agree.
 *
 * The preview is the server's, asked with the same three arguments the write takes, so nothing
 * here decides what an import means — it shows the answer and holds the button until the answer
 * is about what is in the form. A bundled server is a command line somebody else wrote, which is
 * why each one is a box with what it would run under it, and why the stdio ones arrive unticked.
 */
export function AgentImportDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [read, setRead] = useState<Read | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: (draft: Draft) => {
      if (!read) throw new Error("Preview the document before importing it.");
      return request(ImportAgentSpecDocument, {
        document: read.document,
        createServers: tickedSlugs(read.bundled, draft.create),
        name: draft.name.trim() || undefined,
      });
    },
    onSuccess: ({ importAgentSpec }) => {
      toast.success(`Imported ${importAgentSpec.name}`);
      onSaved();
      onClose();
    },
  });

  const form = useAppForm({
    defaultValues: { text: "", name: "", create: [] } as Draft,
    onSubmit: ({ value }) => save.mutateAsync(value),
  });

  // The first reading, with nothing named: it is what says which servers the document bundles
  // and which of them a form should offer ticked, and the ticks cannot be set before that. Made
  // by the button and by a chosen file rather than as the box is typed in, so a half-pasted
  // document is not a request per keystroke.
  const reading = useMutation({
    mutationFn: async (text: string) => {
      const parsed = readSpec(text);
      if (parsed.problem !== undefined) throw new Error(parsed.problem);
      const { agentSpecPreview } = await request(AgentSpecPreviewDocument, {
        document: parsed.document,
      });
      return { text, document: parsed.document, bundled: agentSpecPreview.bundled };
    },
    onSuccess: (next) => {
      setRead(next);
      form.setFieldValue("create", initialTicks(next.bundled));
    },
  });

  const values = useStore(form.store, (state) => state.values);
  // Only while the box still holds what was read.
  const current = read && read.text === values.text ? read : null;
  const createServers = current ? tickedSlugs(current.bundled, values.create) : [];
  const name = values.name.trim();

  const preview = useQuery({
    queryKey: ["agent-spec-preview", current?.text, createServers, name],
    queryFn: () =>
      request(AgentSpecPreviewDocument, {
        document: current?.document,
        createServers,
        name: name || undefined,
      }),
    enabled: Boolean(current),
    // A tick is a new question, and the old answer stays up while it is asked rather than the
    // whole preview collapsing to a skeleton and back under the pointer.
    placeholderData: keepPreviousData,
    // The answer depends on which servers exist here, and that moves in another tab.
    staleTime: 0,
    gcTime: 0,
  });
  const shown = current ? preview.data?.agentSpecPreview : undefined;
  const settled = !preview.isFetching && !preview.isPlaceholderData;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    form.setFieldValue("text", text);
    reading.mutate(text);
  };

  return (
    <DialogLayout
      open
      onOpenChange={(open) => !open && onClose()}
      hasUnsavedChanges={form.state.isDirty}
      size="lg"
      title="Import an agent profile"
      description="From an agent spec file. Nothing is saved until you have read what it would do."
      content={
        <form
          id="agent-import"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <TextareaField
            form={form}
            name="text"
            label="Agent spec"
            description={
              <>
                The contents of a <code>.agent.json</code> file. A spec carries no API key.
              </>
            }
            rows={6}
            className="max-h-64 font-mono text-xs"
            placeholder='{ "spec": "cubicecho.agent/1", "name": "…" }'
            validators={{
              onChange: ({ value }: { value: string }) =>
                value.trim() ? readSpec(value).problem : undefined,
            }}
          />
          <div className="flex justify-end gap-2">
            <input
              ref={picker}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Agent spec file"
              onChange={(event) => {
                choose(event.target.files?.[0]);
                // The same file chosen twice is still a choice, and an input that kept its value
                // would not say so.
                event.target.value = "";
              }}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => picker.current?.click()}>
              <FileUp className="size-4" />
              Choose a file
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={
                reading.isPending || Boolean(current) || readSpec(values.text).problem !== undefined
              }
              onClick={() => reading.mutate(values.text)}
            >
              <ScanSearch className="size-4" />
              Preview
            </Button>
          </div>

          {current && preview.isError ? (
            <QueryError
              error={preview.error}
              onRetry={() => preview.refetch()}
              what="the preview"
            />
          ) : null}

          {shown ? (
            <>
              {shown.refusals.length ? (
                <Section
                  title="Cannot be imported"
                  divider
                  content={<Lines lines={shown.refusals} tone="refusal" />}
                />
              ) : null}

              {shown.agent ? (
                <Section
                  title="Profile"
                  divider
                  content={
                    <div className="flex flex-col gap-3">
                      <InputField
                        form={form}
                        name="name"
                        label="Name"
                        description="Blank keeps the document's own."
                        placeholder={shown.agent.name}
                      />
                      {shown.agent.description ? (
                        <p className="text-muted-foreground text-sm">{shown.agent.description}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-1">
                        {overrides(shown.agent).length === 0 ? (
                          <span className="text-muted-foreground text-xs">
                            Overrides nothing — a task on it runs exactly as one on Settings.
                          </span>
                        ) : (
                          overrides(shown.agent).map((one) => (
                            <span
                              key={one}
                              className="rounded-md border px-2 py-0.5 font-mono text-muted-foreground text-xs"
                            >
                              {one}
                            </span>
                          ))
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 text-sm">
                        {shown.servers ? (
                          <>
                            <span className="text-muted-foreground">Reaches only</span>
                            {shown.servers.map((server) => (
                              <Badge key={server.slug} variant="outline">
                                {server.label || server.slug}
                                {server.created ? " (new)" : ""}
                              </Badge>
                            ))}
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            Reaches every enabled MCP server.
                          </span>
                        )}
                      </div>
                    </div>
                  }
                />
              ) : null}

              {shown.bundled.length ? (
                <Section
                  title="Bundled MCP servers"
                  description="Ticked ones are created here, enabled. A command is run on this machine."
                  divider
                  content={
                    <div className="flex flex-col gap-3">
                      {shown.bundled.map((server, index) => (
                        <CheckboxField
                          key={server.slug}
                          form={form}
                          name={`create[${index}]`}
                          label={`${server.label || server.slug} (${server.transport})`}
                          description={bundledNote(server)}
                        />
                      ))}
                    </div>
                  }
                />
              ) : null}

              {shown.warnings.length ? (
                <Section title="Worth knowing" divider content={<Lines lines={shown.warnings} />} />
              ) : null}

              {shown.dropped.length ? (
                <Section
                  title="Not kept"
                  description="A profile here has no column for these, so a later export will not have them."
                  divider
                  content={<Lines lines={shown.dropped} />}
                />
              ) : null}
            </>
          ) : null}
        </form>
      }
      // A function, so Cancel leaves through the dialog's own door and is asked about a pasted
      // document the same as Escape is.
      footerActions={(close) => (
        <>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton
              form="agent-import"
              pendingLabel="Importing…"
              disabled={!mayImport(shown, settled)}
            >
              Import
            </form.SubmitButton>
          </form.AppForm>
        </>
      )}
    />
  );
}
