import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ModelSelect } from "@/components/model-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CreateTaskDocument,
  CreateTriggerDocument,
  DeleteTriggerDocument,
  type TaskFieldsFragment,
  TriggersKindEnum,
  UpdateTaskDocument,
  UpdateTriggerDocument,
} from "@/gql/graphql";
import { request } from "@/lib/gql";

/** A trigger being edited. `id` is absent until it has been saved. */
interface DraftTrigger {
  id?: string;
  cron: string;
  timezone: string;
}

const EXAMPLES = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Weekday mornings", cron: "0 9 * * 1-5" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
];

/**
 * Create or edit one task and its cron triggers.
 *
 * Triggers are saved as separate mutations after the task, because nested writes need an async
 * SQLite driver (see `server/graphql/schema.ts`). That means a task can save while a trigger
 * fails, so the task is saved first and its triggers reported separately — a half-saved task
 * the user can see and retry beats a silent rollback of the part that worked.
 */
export function TaskDialog({
  task,
  onClose,
  onSaved,
}: {
  task?: TaskFieldsFragment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(task?.name ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [model, setModel] = useState(task?.model ?? "");
  const [systemPrompt, setSystemPrompt] = useState(task?.systemPrompt ?? "");
  const [triggers, setTriggers] = useState<DraftTrigger[]>(
    task?.triggers
      .filter((trigger) => trigger.kind === TriggersKindEnum.Cron)
      .map((trigger) => ({ id: trigger.id, cron: trigger.cron, timezone: trigger.timezone })) ?? [],
  );
  const [removed, setRemoved] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: async () => {
      const values = { name: name.trim(), prompt: prompt.trim(), model, systemPrompt };
      // Caught here so the message names the field, rather than arriving as a server error.
      if (!values.name) throw new Error("A task needs a name.");
      if (!values.prompt) throw new Error("A task needs a prompt.");

      const taskId = task
        ? ((await request(UpdateTaskDocument, { id: task.id, set: values })).updateTaskSingle?.id ??
          task.id)
        : (await request(CreateTaskDocument, { values })).createTask.id;

      for (const id of removed) await request(DeleteTriggerDocument, { id });
      for (const trigger of triggers) {
        if (!trigger.cron.trim()) continue;
        const set = { cron: trigger.cron.trim(), timezone: trigger.timezone.trim() };
        if (trigger.id) await request(UpdateTriggerDocument, { id: trigger.id, set });
        else
          await request(CreateTriggerDocument, {
            values: { taskId, kind: TriggersKindEnum.Cron, ...set },
          });
      }
    },
    onSuccess: () => {
      toast.success(task ? "Task saved" : "Task created");
      onSaved();
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setTrigger = (index: number, patch: Partial<DraftTrigger>) =>
    setTriggers((current) =>
      current.map((trigger, i) => (i === index ? { ...trigger, ...patch } : trigger)),
    );

  const dropTrigger = (index: number) => {
    const trigger = triggers[index];
    if (trigger.id) setRemoved((current) => [...current, trigger.id as string]);
    setTriggers((current) => current.filter((_, i) => i !== index));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            The prompt is what the agent is asked to do each time this task fires.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Morning brief"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="prompt">Prompt</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              placeholder="Check the build status and summarise anything that broke overnight."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="model">Model</Label>
              <ModelSelect
                id="model"
                value={model}
                onChange={setModel}
                defaultLabel="Default from Settings"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="system">System prompt</Label>
              <Input
                id="system"
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                placeholder="(default from Settings)"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Schedule</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTriggers((current) => [...current, { cron: "", timezone: "" }])}
              >
                <Plus className="size-4" />
                Add
              </Button>
            </div>

            {triggers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No schedule — the task only runs when you press play.
              </p>
            ) : null}

            {triggers.map((trigger, index) => (
              <div key={trigger.id ?? `new-${index}`} className="flex items-center gap-2">
                <Input
                  className="font-mono"
                  value={trigger.cron}
                  onChange={(event) => setTrigger(index, { cron: event.target.value })}
                  placeholder="0 9 * * *"
                />
                <Input
                  className="w-52"
                  value={trigger.timezone}
                  onChange={(event) => setTrigger(index, { timezone: event.target.value })}
                  placeholder="America/Chicago"
                />
                <Button variant="ghost" size="icon" onClick={() => dropTrigger(index)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}

            <div className="flex gap-2 text-xs text-muted-foreground">
              {EXAMPLES.map((example) => (
                <button
                  key={example.cron}
                  type="button"
                  className="rounded-md border px-2 py-1 hover:bg-accent"
                  onClick={() =>
                    setTriggers((current) => [...current, { cron: example.cron, timezone: "" }])
                  }
                >
                  {example.label} <span className="font-mono">{example.cron}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
