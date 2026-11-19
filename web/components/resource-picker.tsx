import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  McpResourceCompletionDocument,
  McpResourcesDocument,
  type McpResourcesQuery,
} from "@/__generated__/graphql/graphql";
import { CompletionField } from "@/components/completion-field";
import { DialogLayout } from "@/components/dialog-layout";
import { List } from "@/components/list";
import { ListItem } from "@/components/list-item";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FileText } from "@/components/ui/icons";
import { request } from "@/lib/gql";
import { expandTemplate, templateVariables } from "@/lib/resource-template";
import { resourcePlaceholder } from "../../shared/resource-placeholder.ts";

/**
 * The resources the connected MCP servers serve, as something a prompt names rather than copies.
 *
 * The other half of `McpPromptButton`, and the opposite answer to the same question. A prompt is
 * expanded into the box because it is somebody else's phrasing, and a working task must not change
 * when they rephrase it. A resource is data, and naming it is asking for what it says on the day:
 * so what lands in the box is a placeholder, `{{resource:<slug>:<uri>}}`, read on every run.
 */

type McpResource = McpResourcesQuery["mcpResources"][number];

/** Shared by every prompt box, for `useMcpPrompts`' reason — and stale with it on a server write. */
const useMcpResources = () =>
  useQuery({
    queryKey: ["mcp", "resources"],
    queryFn: () => request(McpResourcesDocument),
    staleTime: 60_000,
  });

const titleOf = (resource: McpResource) => resource.title.trim() || resource.name;

/**
 * The button that opens the picker, drawn only where there is something to pick — absent rather
 * than disabled, for `McpPromptButton`'s reason.
 */
export function McpResourceButton({
  onInsert,
  className,
}: {
  /** Handed the placeholder, to put into the prompt. */
  onInsert: (placeholder: string) => void;
  className?: string;
}) {
  const resources = useMcpResources();
  const [open, setOpen] = useState(false);

  if (!resources.data?.mcpResources.length) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
        iconSlot={<FileText />}
        content="MCP resource"
      />
      {open ? (
        <ResourceDialog
          resources={resources.data.mcpResources}
          onClose={() => setOpen(false)}
          onInsert={onInsert}
        />
      ) : null}
    </>
  );
}

function ResourceDialog({
  resources,
  onClose,
  onInsert,
}: {
  resources: McpResource[];
  onClose: () => void;
  onInsert: (placeholder: string) => void;
}) {
  const [chosen, setChosen] = useState<McpResource | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const insert = (resource: McpResource, uri: string) => {
    onInsert(resourcePlaceholder({ server: resource.serverSlug, uri }));
    onClose();
  };

  /** A fixed resource has nothing to fill in, so picking it is the whole interaction. */
  const pick = (resource: McpResource) => {
    setValues({});
    if (resource.template) {
      setChosen(resource);
    } else {
      insert(resource, resource.uri);
    }
  };

  const variables = chosen ? templateVariables(chosen.uri) : null;
  const missing = variables?.some((name) => !values[name]?.trim()) ?? true;
  const filled = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, value.trim()]),
  );
  const uri = chosen && variables && !missing ? expandTemplate(chosen.uri, filled) : "";

  return (
    <DialogLayout
      open
      onOpenChange={(next) => !next && onClose()}
      size="lg"
      title={chosen ? titleOf(chosen) : "Name an MCP resource"}
      description={
        chosen
          ? chosen.description || `A resource template ${chosen.serverLabel} serves.`
          : "What the connected MCP servers serve. The one you pick goes into the prompt as a " +
            "placeholder, and every run reads it fresh — the task saves the name, not the text."
      }
      contentSlot={
        <div className="flex flex-col gap-3">
          {chosen ? (
            <>
              {variables ? (
                variables.map((name, index) => (
                  <CompletionField
                    key={name}
                    label={name}
                    required
                    value={values[name] ?? ""}
                    onChange={(next) => setValues((held) => ({ ...held, [name]: next }))}
                    queryKey={[
                      "mcp",
                      "resources",
                      "complete",
                      chosen.server,
                      chosen.uri,
                      name,
                      filledBefore(variables, index, filled),
                    ]}
                    suggest={async (typed) =>
                      (
                        await request(McpResourceCompletionDocument, {
                          server: chosen.server,
                          uri: chosen.uri,
                          variable: name,
                          value: typed,
                          context: filledBefore(variables, index, filled),
                        })
                      ).mcpResourceCompletion
                    }
                  />
                ))
              ) : (
                <Alert
                  variant="destructive"
                  description={`${chosen.uri} is not a template this app can fill in.`}
                />
              )}
              {uri ? <p className="break-all font-mono text-foreground/60 text-xs">{uri}</p> : null}
            </>
          ) : (
            <List
              label="MCP resources"
              contentSlot={resources.map((resource) => (
                <ListItem
                  key={`${resource.server}/${resource.uri}`}
                  onClick={() => pick(resource)}
                  title={titleOf(resource)}
                  description={resource.description || resource.uri}
                  meta={resource.serverLabel}
                />
              ))}
            />
          )}
        </div>
      }
      footerActionsSlot={(close) => (
        <>
          <Button
            variant="outline"
            onClick={chosen ? () => setChosen(null) : close}
            content={chosen ? "Back" : "Cancel"}
          />
          {chosen ? (
            <Button
              onClick={() => insert(chosen, uri)}
              disabled={!uri}
              hint={missing ? "Fill in every variable first." : undefined}
              content="Insert"
            />
          ) : null}
        </>
      )}
    />
  );
}

/**
 * The variables above this one that have something in them, which is what a server narrows a
 * later one by — the prompt picker's rule, for its reason.
 */
function filledBefore(variables: string[], index: number, values: Record<string, string>) {
  return Object.fromEntries(
    variables
      .slice(0, index)
      .map((name) => [name, values[name] ?? ""] as const)
      .filter(([, value]) => value !== ""),
  );
}
