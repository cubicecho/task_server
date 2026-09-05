import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AgentOptionsDocument,
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
import { useAppForm } from "@/components/app-form";
import { FieldRow } from "@/components/field-row";
import { ModelSelectField } from "@/components/model-select-field";
import { PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-state";
import { Section } from "@/components/section";
import { StepList } from "@/components/step-editor";
import { type DraftTrigger, TriggerEditor, toDraftTriggers } from "@/components/trigger-editor";
import { Button } from "@/components/ui/button";
import { describeFor } from "@/lib/docs";
import { type DraftStep, toDraft, toInput } from "@/lib/flow";
import { request } from "@/lib/gql";

/**
 * The page behind `/tasks/new` and `/tasks/$taskId`.
 *
 * An existing task is fetched whole — triggers and flow included — before the form is built,
 * so the form is initialised once from real data rather than patched into shape afterwards.
 */
/** The notes under this form's fields are the columns' own descriptions. */
const doc = describeFor("Task");

// Radix refuses an empty item value, so "no profile" — which is null in the column — carries one.
const NO_AGENT = "__settings__";

const DESCRIPTION = "The prompt is step one. Everything in the flow runs after it, in order.";

/** Back to the list, in the slot a page's back link belongs in. */
const Breadcrumbs = () => (
  <Link to="/tasks" className="flex items-center gap-1 hover:underline">
    <ArrowLeft className="size-3.5" />
    Tasks
  </Link>
);

export function TaskEditRoute() {
  const { taskId } = useParams({ strict: false });

  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => request(TaskDocument, { id: taskId as string }),
    enabled: Boolean(taskId),
  });

  if (!taskId) return <TaskForm />;
  if (task.isPending || task.isError || !task.data?.task) {
    return (
      <PageLayout
        title="Task"
        description={DESCRIPTION}
        breadcrumbs={<Breadcrumbs />}
        loading={task.isPending}
        content={
          task.isPending ? null : (
            <QueryError
              // A task that is simply not there is not a failed request, and saying "try again"
              // about it would be a lie — so the absence is phrased as the error it is.
              error={(task.error as Error | null) ?? new Error("There is no task with that id.")}
              onRetry={() => task.refetch()}
              what="that task"
            />
          )
        }
      />
    );
  }
  // Keyed so that navigating between two tasks rebuilds the form instead of keeping the
  // first one's edits.
  return <TaskForm key={task.data.task.id} task={task.data.task} />;
}

/**
 * Everything the page edits, in one store.
 *
 * The triggers and the flow are in here beside the five columns rather than in `useState` of
 * their own, so "are there unsaved changes" has one answer and the save writes one value.
 */
interface Form {
  name: string;
  prompt: string;
  agentId: string;
  model: string;
  systemPrompt: string;
  triggers: DraftTrigger[];
  /**
   * The flow, held as `unknown` and cast at the two places it crosses this boundary.
   *
   * A step holds branches and a branch holds steps, so the type contains itself — and
   * TanStack Form types a field's `name` by walking the whole store's shape, which on a tree
   * like that does not terminate (`TS2589`, on the first field in the form rather than on the
   * flow). `unknown` is the one thing that walk stops at, so it is what keeps the flow in the
   * same store as the rest and the tree still typed everywhere it is actually edited.
   */
  steps: unknown;
}

const required = (what: string) => ({
  onChange: ({ value }: { value: string }) => (value.trim() ? undefined : what),
});

function TaskForm({ task }: { task?: TaskDetailFieldsFragment }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Not a field: it is the tail of what the *last* save has to delete, not a value being edited.
  const [removed, setRemoved] = useState<string[]>([]);

  // Names only, and shared with every other form that needs them: a page that lists two tasks
  // side by side asks the server once.
  const agents = useQuery({
    queryKey: ["agents", "options"],
    queryFn: () => request(AgentOptionsDocument),
  });

  const save = useMutation({
    mutationFn: async (form: Form) => {
      // Null rather than "": the column is a foreign key, and an empty string is not a profile.
      const values = {
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        agentId: form.agentId === NO_AGENT ? null : form.agentId,
        model: form.model,
        systemPrompt: form.systemPrompt,
      };

      const taskId = task
        ? ((await request(UpdateTaskDocument, { id: task.id, set: values })).updateTaskSingle?.id ??
          task.id)
        : (await request(CreateTaskDocument, { values })).createTask.id;

      // Triggers are saved one by one because `nestedWrites` is off (see
      // `server/graphql/schema.ts`). The flow is not: `setTaskSteps` writes the tree in one
      // transaction, so a flow either lands whole or not at all.
      for (const id of removed) await request(DeleteTriggerDocument, { id });
      const saved: DraftTrigger[] = [];
      for (const trigger of form.triggers) {
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

      const written = await request(SetTaskStepsDocument, {
        taskId,
        steps: toInput(form.steps as DraftStep[]),
      });
      return { taskId, triggers: saved, steps: toDraft(written.setTaskSteps) };
    },
  });

  // Annotated, not `satisfies`: the form's field names are typed from what is passed here, so
  // the flow has to arrive as `Form` says it does — opaquely — rather than as `toDraft` returns it.
  const defaults: Form = {
    name: task?.name ?? "",
    prompt: task?.prompt ?? "",
    agentId: task?.agentId ?? NO_AGENT,
    model: task?.model ?? "",
    systemPrompt: task?.systemPrompt ?? "",
    triggers: toDraftTriggers(task?.triggers ?? []),
    steps: toDraft(task?.steps ?? []),
  };

  const form = useAppForm({
    defaultValues: defaults,
    onSubmit: async ({ value, formApi }) => {
      const written = await save.mutateAsync(value);
      toast.success(task ? "Task saved" : "Task created");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", written.taskId] });
      // The ids the server assigned come back, so a second save edits the same rows rather
      // than replacing them and orphaning their run history. The form is keyed on the task, so
      // the refetch behind these invalidations does not rebuild it — without this a second save
      // created every trigger a second time, and deleting one it had just created deleted
      // nothing, because the draft still had no id to delete by.
      formApi.reset({ ...value, triggers: written.triggers, steps: written.steps });
      setRemoved([]);
      if (!task) navigate({ to: "/tasks/$taskId", params: { taskId: written.taskId } });
    },
  });

  return (
    <PageLayout
      title={task ? "Edit task" : "New task"}
      description={DESCRIPTION}
      breadcrumbs={<Breadcrumbs />}
      action={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate({ to: "/tasks" })}>
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton form="task">Save</form.SubmitButton>
          </form.AppForm>
        </div>
      }
      content={
        <form
          id="task"
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.AppField name="name" validators={required("A task needs a name.")}>
            {(field) => <field.InputField label="Name" required placeholder="Morning brief" />}
          </form.AppField>

          <div className="flex flex-col gap-2">
            <form.AppField name="prompt" validators={required("A task needs a prompt.")}>
              {(field) => (
                <field.TextareaField
                  label="Prompt"
                  required
                  description={doc("prompt")}
                  rows={5}
                  placeholder="Check the build status and summarise anything that broke overnight."
                />
              )}
            </form.AppField>
            {/* Only worth saying where there is a webhook to say it about — on a task started by
                hand or on a schedule the placeholder has nothing to put there. */}
            <form.Subscribe
              selector={(state) => state.values.triggers.some((t) => t.kind === "event")}
            >
              {(hasWebhook) =>
                hasWebhook ? (
                  <p className="text-muted-foreground text-sm">
                    Write <code>{"{{event}}"}</code> to place the body of the webhook that started
                    the run. A run started any other way renders it as a note saying there was none.
                  </p>
                ) : null
              }
            </form.Subscribe>
          </div>

          <form.AppField name="agentId">
            {(field) => (
              <field.SelectField
                label="Agent profile"
                description={doc("agentId")}
                options={[
                  { value: NO_AGENT, label: "Server settings" },
                  ...(agents.data?.agents ?? []).map((agent) => ({
                    value: agent.id,
                    label: (
                      <>
                        {agent.name}
                        {agent.description ? (
                          <span className="text-muted-foreground"> — {agent.description}</span>
                        ) : null}
                      </>
                    ),
                  })),
                ]}
              />
            )}
          </form.AppField>

          {/* The model picker asks the *profile's* endpoint for its models, so it is subscribed
              to the field above rather than reading a snapshot taken on render. */}
          <form.Subscribe selector={(state) => state.values.agentId}>
            {(agentId) => (
              <FieldRow
                content={
                  <>
                    <ModelSelectField
                      form={form}
                      name="model"
                      label="Model"
                      description={
                        agentId === NO_AGENT
                          ? doc("model")
                          : "Empty falls back to the profile above, then to Settings."
                      }
                      defaultLabel={
                        agentId === NO_AGENT ? "Default from Settings" : "Default from the profile"
                      }
                      agentId={agentId === NO_AGENT ? undefined : agentId}
                    />
                    <form.AppField name="systemPrompt">
                      {(field) => (
                        <field.InputField
                          label="System prompt"
                          description={doc("systemPrompt")}
                          placeholder="(default from Settings)"
                        />
                      )}
                    </form.AppField>
                  </>
                }
              />
            )}
          </form.Subscribe>

          <form.Field name="triggers">
            {(field) => (
              <TriggerEditor
                triggers={field.state.value}
                onChange={field.handleChange}
                onRemoveSaved={(id) => setRemoved((current) => [...current, id])}
              />
            )}
          </form.Field>

          <Section
            title="Flow"
            description={
              <>
                Each step is shown what came before it. Write <code>{"{{previous}}"}</code> or{" "}
                <code>{"{{steps.<name>}}"}</code> in a prompt to place that output yourself. A
                decision runs like any other step — tools included — and then picks which of its
                cases runs next.
              </>
            }
            content={
              <form.Field name="steps">
                {(field) => (
                  <StepList
                    steps={field.state.value as DraftStep[]}
                    onChange={field.handleChange}
                  />
                )}
              </form.Field>
            }
          />
        </form>
      }
    />
  );
}
