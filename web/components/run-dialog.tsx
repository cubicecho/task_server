import { useQuery } from "@tanstack/react-query";
import { LastPayloadDocument } from "@/__generated__/graphql/graphql";
import { useAppForm } from "@/components/app-form";
import { DialogLayout } from "@/components/dialog-layout";
import { Button } from "@/components/ui/button";
import { request } from "@/lib/gql";
import { parseJson } from "@/lib/json";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * Starts a task with a webhook body typed by hand.
 *
 * The two things this exists for are the same thing from either end. A delivery that failed has
 * its body stored on the run and nothing that could hand it back, so the only way to try the fix
 * was to ask the sender to send again. A prompt with `{{event}}` in it had no way to be tried at
 * all before a sender existed — the first honest test of the template was in production.
 *
 * The body is shown rather than replayed silently, and the run it starts is a hand-started one:
 * this is a person deciding to run something, and the dialog is where they see exactly what
 * they are about to run it with.
 */
export function RunDialog({
  taskId,
  taskName,
  body,
  onClose,
  onRun,
}: {
  taskId: string;
  taskName: string;
  /** The body to start from. Left out, the last one this task saw is fetched and offered. */
  body?: unknown;
  onClose: () => void;
  onRun: (payload: unknown) => void;
}) {
  const last = useQuery({
    queryKey: ["last-payload", taskId],
    queryFn: () => request(LastPayloadDocument, { taskId }),
    enabled: body === undefined,
  });

  // The box is filled once, when the form mounts, so nothing lands in it behind the cursor.
  // Waiting for the fetch rather than filling it late is why this shows nothing for the moment
  // it takes: the query is one row by id, and only runs when there is no body to start from.
  if (body === undefined && last.isPending) return null;

  const found = last.data?.runs[0];
  const prefill = body !== undefined ? pretty(body) : found ? pretty(found.payload) : "";

  return (
    <BodyForm
      taskName={taskName}
      prefill={prefill}
      description={
        body !== undefined
          ? "The body this run was given. Edit it to try something else."
          : found
            ? "The last body this task saw. Edit it, or empty the box to run with none."
            : "JSON. Empty runs the task with no body, as pressing play does."
      }
      onClose={onClose}
      onRun={onRun}
    />
  );
}

function BodyForm({
  taskName,
  prefill,
  description,
  onClose,
  onRun,
}: {
  taskName: string;
  prefill: string;
  description: string;
  onClose: () => void;
  onRun: (payload: unknown) => void;
}) {
  const form = useAppForm({
    defaultValues: { body: prefill },
    onSubmit: ({ value }) => {
      // Already known to parse — the field refuses to submit otherwise.
      onRun(parseJson<unknown>(value.body, "The body", null));
      onClose();
    },
  });

  return (
    <DialogLayout
      open
      onOpenChange={(open) => !open && onClose()}
      hasUnsavedChanges={form.state.isDirty}
      size="lg"
      title={`Run ${taskName} with a body`}
      description={
        <>
          The prompt sees it as <code>{"{{event}}"}</code>, exactly as a delivery to one of this
          task's webhooks would be. The run is a hand-started one and names no trigger.
        </>
      }
      content={
        <form
          id="run-body"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.AppField
            name="body"
            validators={{
              // Malformed JSON used to be a toast on the way out, which arrived after the dialog
              // was already gone and said nothing about where in the box the fault was.
              onChange: ({ value }: { value: string }) => {
                try {
                  parseJson<unknown>(value, "The body", null);
                  return undefined;
                } catch (error) {
                  return (error as Error).message;
                }
              },
            }}
          >
            {(field) => (
              <field.TextareaField
                label="Body"
                description={description}
                rows={10}
                className="font-mono text-xs"
                placeholder={'{ "repository": "task_server", "status": "failed" }'}
              />
            )}
          </form.AppField>
        </form>
      }
      footerActions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton form="run-body" pendingLabel="Starting…">
              Run
            </form.SubmitButton>
          </form.AppForm>
        </>
      }
    />
  );
}
