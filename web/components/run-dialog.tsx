import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { LastPayloadDocument } from "@/__generated__/graphql/graphql";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
  // Null rather than the prefill as the initial state, so a fetch that lands after the dialog
  // opens still fills the box — and stops filling it the moment anyone types.
  const [edited, setEdited] = useState<string | null>(null);

  const last = useQuery({
    queryKey: ["last-payload", taskId],
    queryFn: () => request(LastPayloadDocument, { taskId }),
    enabled: body === undefined,
  });

  const found = last.data?.runs[0];
  const prefill = body !== undefined ? pretty(body) : found ? pretty(found.payload) : "";
  const text = edited ?? prefill;

  const start = () => {
    let payload: unknown;
    try {
      // An empty box is a run with no body at all, which is what every other run is.
      payload = parseJson<unknown>(text, "The body", null);
    } catch (error) {
      toast.error((error as Error).message);
      return;
    }
    onRun(payload);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Run {taskName} with a body</DialogTitle>
          <DialogDescription>
            The prompt sees it as <code>{"{{event}}"}</code>, exactly as a delivery to one of this
            task's webhooks would be. The run is a hand-started one and names no trigger.
          </DialogDescription>
        </DialogHeader>

        <Field
          label="Body"
          htmlFor="payload"
          hint={
            body !== undefined
              ? "The body this run was given. Edit it to try something else."
              : found
                ? "The last body this task saw. Edit it, or empty the box to run with none."
                : "JSON. Empty runs the task with no body, as pressing play does."
          }
        >
          <Textarea
            id="payload"
            rows={10}
            className="font-mono text-xs"
            value={text}
            onChange={(event) => setEdited(event.target.value)}
            placeholder={'{ "repository": "task_server", "status": "failed" }'}
          />
        </Field>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={start}>Run</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
