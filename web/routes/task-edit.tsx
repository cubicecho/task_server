import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  CreateTaskDocument,
  CreateTriggerDocument,
  DeleteTriggerDocument,
  SetTaskStepsDocument,
  type TaskDetailFieldsFragment,
  TaskDocument,
  TriggersKindEnum,
  UpdateTaskDocument,
  UpdateTriggerDocument,
} from "@/__generated__/graphql/graphql";
import { Page } from "@/components/app-shell";
import { Field } from "@/components/field";
import { ModelSelect } from "@/components/model-select";
import { StepList } from "@/components/step-editor";
import { type DraftTrigger, TriggerEditor, toDraftTriggers } from "@/components/trigger-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type DraftStep, toDraft, toInput } from "@/lib/flow";
import { request } from "@/lib/gql";

/**
 * The page behind `/tasks/new` and `/tasks/$taskId`.
 *
 * An existing task is fetched whole — triggers and flow included — before the form is built,
 * so the form is initialised once from real data rather than patched into shape afterwards.
 */
export function TaskEditRoute() {
  const { taskId } = useParams({ strict: false });

  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => request(TaskDocument, { id: taskId as string }),
    enabled: Boolean(taskId),
  });

  if (!taskId) return <TaskForm />;
  if (task.isPending) {
    return (
      <Page title="Task">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Page>
    );
  }
  if (task.error || !task.data?.task) {
    return (
      <Page title="Task">
        <p className="text-sm text-destructive">
          {(task.error as Error | null)?.message ?? "There is no task with that id."}
        </p>
        <Back />
      </Page>
    );
  }
  // Keyed so that navigating between two tasks rebuilds the form instead of keeping the
  // first one's edits.
  return <TaskForm key={task.data.task.id} task={task.data.task} />;
}

const Back = () => (
  <Link
    to="/tasks"
    className="flex items-center gap-1 text-sm text-muted-foreground hover:underline"
  >
    <ArrowLeft className="size-4" />
    Back to tasks
  </Link>
);

function TaskForm({ task }: { task?: TaskDetailFieldsFragment }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState(task?.name ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [model, setModel] = useState(task?.model ?? "");
  const [systemPrompt, setSystemPrompt] = useState(task?.systemPrompt ?? "");
  const [triggers, setTriggers] = useState<DraftTrigger[]>(() =>
    toDraftTriggers(task?.triggers ?? []),
  );
  const [removed, setRemoved] = useState<string[]>([]);

  const [steps, setSteps] = useState<DraftStep[]>(() => toDraft(task?.steps ?? []));

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

      // Triggers are saved one by one because `nestedWrites` is off (see
      // `server/graphql/schema.ts`). The flow is not: `setTaskSteps` writes the tree in one
      // transaction, so a flow either lands whole or not at all.
      for (const id of removed) await request(DeleteTriggerDocument, { id });
      const saved: DraftTrigger[] = [];
      for (const trigger of triggers) {
        // A row left blank is one that was added and never filled in, which is not an edit to
        // save. A webhook with no id would be worse than nothing: no address reaches it.
        const cron = trigger.cron.trim();
        const event = trigger.event.trim();
        if (trigger.kind === "cron" ? !cron : !event) {
          saved.push(trigger);
          continue;
        }

        const kind = trigger.kind === "cron" ? TriggersKindEnum.Cron : TriggersKindEnum.Event;
        const set = {
          kind,
          cron,
          timezone: trigger.timezone.trim(),
          event,
          enabled: trigger.enabled,
        };
        let id = trigger.id;
        if (id) {
          await request(UpdateTriggerDocument, { id, set });
        } else {
          id = (await request(CreateTriggerDocument, { values: { taskId, ...set } })).createTrigger
            .id;
        }
        // The trimmed values go back too, so the row reads as what was actually stored.
        saved.push({ ...trigger, id, cron, event, timezone: set.timezone });
      }

      const written = await request(SetTaskStepsDocument, { taskId, steps: toInput(steps) });
      return { taskId, triggers: saved, steps: written.setTaskSteps };
    },
    onSuccess: ({ taskId, triggers: savedTriggers, steps: written }) => {
      toast.success(task ? "Task saved" : "Task created");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      // The ids the server assigned come back, so a second save edits the same rows rather
      // than replacing them and orphaning their run history. The form is keyed on the task, so
      // the refetch behind these invalidations does not rebuild it — without this a second save
      // created every trigger a second time, and deleting one it had just created deleted
      // nothing, because the draft still had no id to delete by.
      setTriggers(savedTriggers);
      setSteps(toDraft(written));
      setRemoved([]);
      if (!task) navigate({ to: "/tasks/$taskId", params: { taskId } });
    },
  });

  return (
    <Page
      wide
      title={task ? "Edit task" : "New task"}
      description="The prompt is step one. Everything in the flow runs after it, in order."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate({ to: "/tasks" })}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <Back />

      <Field label="Name" htmlFor="name">
        <Input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Morning brief"
        />
      </Field>

      <Field label="Prompt" htmlFor="prompt">
        <Textarea
          id="prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={5}
          placeholder="Check the build status and summarise anything that broke overnight."
        />
        {/* Only worth saying where there is a webhook to say it about — on a task started by
            hand or on a schedule the placeholder has nothing to put there. */}
        {triggers.some((trigger) => trigger.kind === "event") ? (
          <p className="text-sm text-muted-foreground">
            Write <code>{"{{event}}"}</code> to place the body of the webhook that started the run.
            A run started any other way renders it as a note saying there was none.
          </p>
        ) : null}
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Model" htmlFor="model">
          <ModelSelect
            id="model"
            value={model}
            onChange={setModel}
            defaultLabel="Default from Settings"
          />
        </Field>
        <Field label="System prompt" htmlFor="system">
          <Input
            id="system"
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            placeholder="(default from Settings)"
          />
        </Field>
      </div>

      <TriggerEditor
        triggers={triggers}
        onChange={setTriggers}
        onRemoveSaved={(id) => setRemoved((current) => [...current, id])}
      />

      <Field label="Flow" className="gap-3">
        <p className="text-sm text-muted-foreground">
          Each step is shown what came before it. Write <code>{"{{previous}}"}</code> or{" "}
          <code>{"{{steps.<name>}}"}</code> in a prompt to place that output yourself. A decision
          runs like any other step — tools included — and then picks which of its cases runs next.
        </p>
        <StepList steps={steps} onChange={setSteps} />
      </Field>
    </Page>
  );
}
