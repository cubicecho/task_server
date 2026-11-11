import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { McpResourceDocument, type RunDetailQuery } from "@/__generated__/graphql/graphql";
import { DialogLayout } from "@/components/dialog-layout";
import { List } from "@/components/list";
import { ListItem } from "@/components/list-item";
import { LoadState } from "@/components/load-state";
import { Markdown } from "@/components/markdown";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code";
import { CopyButton } from "@/components/ui/copy-button";
import { Eye } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { request } from "@/lib/gql";
import { artifactActions, artifactLabel, isMarkdown } from "@/lib/run-artifacts";

type Detail = RunDetailQuery["runs"][number];
type Artifact = Detail["artifacts"][number];

/**
 * One artifact read back from its server, as it is now.
 *
 * Fetched when the dialog opens and never cached past it: the content is the server's, and a doc
 * edited since the run should read as edited. `lastModified` is the row's — what the server said
 * when the run linked it — so a person can tell the two apart.
 */
function ArtifactPreview({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const serverId = artifact.serverId ?? "";
  const resource = useQuery({
    queryKey: ["mcp-resource", serverId, artifact.uri],
    queryFn: () => request(McpResourceDocument, { serverId, uri: artifact.uri }),
    gcTime: 0,
    // A server that serves no resources says so the first time; asking twice more says it again.
    retry: false,
  });
  const read = resource.data?.mcpResource;
  const modified = artifact.lastModified
    ? `Last modified ${new Date(artifact.lastModified).toLocaleString()} when the run linked it. `
    : "";

  return (
    <DialogLayout
      open
      onOpenChange={(open) => !open && onClose()}
      size="xl"
      title={artifactLabel(artifact)}
      description={`${modified}Read from ${artifact.serverSlug || "its server"} just now, so it shows what is there today.`}
      contentSlot={
        read ? (
          <div className="flex flex-col gap-2">
            {read.truncated ? (
              <p className="text-foreground/60 text-xs">Cut short — the rest is on the server.</p>
            ) : null}
            {isMarkdown(read.mimeType, artifact.mimeType) ? (
              <Markdown
                content={read.text}
                emptySlot={
                  <p className="text-foreground/60 text-sm">The server sent nothing back.</p>
                }
              />
            ) : (
              <CodeBlock content={read.text || "(empty)"} wrap />
            )}
          </div>
        ) : (
          <LoadState query={resource} what="this output" record={read} notFoundLabel="Not found" />
        )
      }
      footerActionsSlot={(close) => <Button variant="outline" onClick={close} content="Close" />}
    />
  );
}

/**
 * What the run made, as links a person can follow out of it: one row per uri the run's tool
 * calls linked to, in the order it first did.
 *
 * Nothing at all when it made nothing — an empty heading on every run that wrote no files would
 * be the most common thing on the page and say the least.
 */
export function RunOutputs({ detail }: { detail: Detail }) {
  const toast = useToast();
  const [previewing, setPreviewing] = useState<Artifact | null>(null);
  if (detail.artifacts.length === 0) {
    return null;
  }
  // A step is named only where the run has steps to name; a one-prompt run's list is empty.
  const stepName = new Map(detail.steps.map((step) => [step.id, step.name]));

  return (
    <>
      <Section
        level={3}
        title="Outputs"
        contentSlot={
          <List
            label="Outputs"
            contentSlot={detail.artifacts.map((artifact) => {
              const label = artifactLabel(artifact);
              const actions = artifactActions(artifact);
              const step = artifact.runStepId ? stepName.get(artifact.runStepId) : undefined;
              const meta = [
                artifact.serverSlug,
                step,
                artifact.count > 1 ? `written ${artifact.count}×` : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <ListItem
                  key={artifact.id}
                  title={label}
                  // The uri under a name that is not already it, so the row says where it lives.
                  description={label === artifact.uri ? undefined : artifact.uri}
                  meta={meta || undefined}
                  actionSlot={
                    <>
                      {actions.open ? (
                        <Button
                          aria-label={`Open ${label}`}
                          variant="outline"
                          size="icon"
                          linkSlot={<a href={actions.open} target="_blank" rel="noreferrer" />}
                          iconSlot={<ExternalLink />}
                        />
                      ) : null}
                      {actions.preview ? (
                        <Button
                          aria-label={`Preview ${label}`}
                          variant="outline"
                          size="icon"
                          disabled={actions.previewRefused !== undefined}
                          hint={actions.previewRefused}
                          onClick={() => setPreviewing(artifact)}
                          iconSlot={<Eye />}
                        />
                      ) : null}
                      <CopyButton
                        value={actions.copy}
                        label="Copy the uri"
                        size="icon"
                        onError={() =>
                          toast("Could not copy. Select the text and copy it by hand.")
                        }
                      />
                    </>
                  }
                />
              );
            })}
          />
        }
      />
      {previewing ? (
        <ArtifactPreview artifact={previewing} onClose={() => setPreviewing(null)} />
      ) : null}
    </>
  );
}
