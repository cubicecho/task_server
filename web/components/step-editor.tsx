import { ChevronDown, ChevronUp, GitBranch, Plus, Trash2, X } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { FieldRow } from "@/components/field-row";
import { FormField } from "@/components/form-field";
import { ModelSelect } from "@/components/model-select";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTEXTS,
  DEFAULT_BRANCH,
  type DraftBranch,
  type DraftStep,
  emptyStep,
  MAX_DEPTH,
  type StepContext,
  sameCase,
} from "@/lib/flow";

const CONTEXT_LABELS: Record<StepContext, string> = {
  all: "Everything so far",
  previous: "Only the step before",
  none: "Nothing — just this prompt",
};

/**
 * A sequence of steps, and the sequences nested inside its decisions.
 *
 * The whole flow is one tree held by the page; every control here hands a new tree upward
 * rather than mutating in place, which is what lets the Text tab re-serialise the same state.
 */
export function StepList({
  steps,
  onChange,
  depth = 0,
}: {
  steps: DraftStep[];
  onChange: (steps: DraftStep[]) => void;
  depth?: number;
}) {
  const replace = (index: number, step: DraftStep) =>
    onChange(steps.map((current, at) => (at === index ? step : current)));

  const move = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, index) => (
        <StepCard
          key={step.key}
          step={step}
          depth={depth}
          first={index === 0}
          last={index === steps.length - 1}
          onChange={(next) => replace(index, next)}
          onRemove={() => onChange(steps.filter((_, at) => at !== index))}
          onMove={(by) => move(index, by)}
        />
      ))}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...steps, emptyStep("agent")])}
        >
          <Plus className="size-4" />
          Add step
        </Button>
        <ActionButton
          type="button"
          label="Add decision"
          tooltip={false}
          variant="outline"
          size="sm"
          // A decision's arms sit one level deeper, and the server refuses past MAX_DEPTH.
          disabled={depth >= MAX_DEPTH}
          hint={depth >= MAX_DEPTH ? `Steps cannot nest more than ${MAX_DEPTH} deep.` : undefined}
          onClick={() => onChange([...steps, emptyStep("decision")])}
        >
          <GitBranch className="size-4" />
          Add decision
        </ActionButton>
      </div>
    </div>
  );
}

function StepCard({
  step,
  depth,
  first,
  last,
  onChange,
  onRemove,
  onMove,
}: {
  step: DraftStep;
  depth: number;
  first: boolean;
  last: boolean;
  onChange: (step: DraftStep) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
}) {
  const patch = (values: Partial<DraftStep>) => onChange({ ...step, ...values });
  const decision = step.kind === "decision";

  // Every declared case gets an arm, and `default` is always on offer — the runner falls back
  // to it when the model answers with something that is not a case at all. One arm per *distinct*
  // case, compared the way the server compares them: two inputs spelling the same case are one
  // branch there, so two editors for it here let whichever was written second discard the
  // other's steps.
  const arms: DraftBranch[] = [...step.cases, DEFAULT_BRANCH]
    .filter((label, at, all) => all.findIndex((other) => sameCase(other, label)) === at)
    .map((label) => ({
      case: label,
      steps: step.branches.find((branch) => sameCase(branch.case, label))?.steps ?? [],
    }));

  /** Whether an earlier case already spells this one — the state the server refuses. */
  const duplicate = (index: number) => {
    const label = step.cases[index];
    return (
      Boolean(label.trim()) && step.cases.some((other, at) => at < index && sameCase(other, label))
    );
  };

  const setArm = (label: string, steps: DraftStep[]) =>
    patch({
      branches: [
        ...step.branches.filter((branch) => !sameCase(branch.case, label)),
        { case: label, steps },
      ],
    });

  const setCase = (index: number, label: string) => {
    const was = step.cases[index];
    const cases = step.cases.map((current, at) => (at === index ? label : current));
    // The arm belongs to the case, not to its spelling: renaming carries its steps along —
    // unless another case is still spelled the old way, in which case the arm is still theirs.
    const stillClaimed = cases.some((other, at) => at !== index && sameCase(other, was));
    patch({
      cases,
      branches: stillClaimed
        ? step.branches
        : step.branches.map((branch) =>
            sameCase(branch.case, was) ? { ...branch, case: label } : branch,
          ),
    });
  };

  const dropCase = (index: number) => {
    const label = step.cases[index];
    const cases = step.cases.filter((_, at) => at !== index);
    patch({
      cases,
      // Only orphan the arm when nothing left claims it: removing one of two inputs spelling the
      // same case used to take the steps under it with them.
      branches: cases.some((other) => sameCase(other, label))
        ? step.branches
        : step.branches.filter((branch) => !sameCase(branch.case, label)),
    });
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
          {decision ? "decision" : "step"}
        </span>
        <Input
          className="h-8 border-0 px-1 font-medium shadow-none focus-visible:ring-0"
          value={step.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder={decision ? "Name this decision" : "Name this step"}
          aria-label={decision ? "Decision name" : "Step name"}
        />
        <Switch
          checked={step.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
          aria-label="Enabled"
          title={step.enabled ? "Runs" : "Skipped"}
        />
        <ActionButton
          type="button"
          label="Move up"
          variant="ghost"
          size="icon"
          disabled={first}
          onClick={() => onMove(-1)}
        >
          <ChevronUp />
        </ActionButton>
        <ActionButton
          type="button"
          label="Move down"
          variant="ghost"
          size="icon"
          disabled={last}
          onClick={() => onMove(1)}
        >
          <ChevronDown />
        </ActionButton>
        <ActionButton
          type="button"
          label={decision ? "Remove this decision" : "Remove this step"}
          variant="ghost"
          size="icon"
          onClick={onRemove}
        >
          <Trash2 />
        </ActionButton>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <Textarea
          value={step.prompt}
          onChange={(event) => patch({ prompt: event.target.value })}
          rows={3}
          aria-label={decision ? "What is being decided" : "Prompt"}
          placeholder={
            decision
              ? "Do any of these report an application error?"
              : "Write what came back to ~/notes/errors.md — {{previous}}"
          }
        />

        {decision ? (
          <Section
            title="Cases"
            action={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => patch({ cases: [...step.cases, ""] })}
              >
                <Plus className="size-4" />
                Add case
              </Button>
            }
            content={
              <>
                <div className="flex flex-wrap gap-2">
                  {step.cases.map((label, index) => (
                    // Cases are reordered by nothing and renamed in place, so the index is stable.
                    // biome-ignore lint/suspicious/noArrayIndexKey: no id, and the list is positional
                    <div key={index} className="flex items-center gap-1">
                      <Input
                        className={`h-8 w-40 font-mono ${duplicate(index) ? "border-destructive" : ""}`}
                        value={label}
                        onChange={(event) => setCase(index, event.target.value)}
                        placeholder="error"
                        aria-label={`Case ${index + 1}`}
                        aria-invalid={duplicate(index)}
                      />
                      <ActionButton
                        type="button"
                        label="Remove this case"
                        variant="ghost"
                        size="icon"
                        onClick={() => dropCase(index)}
                      >
                        <X />
                      </ActionButton>
                    </div>
                  ))}
                </div>
                {/* Said here rather than at save time: the server refuses the whole flow over it,
                    and by then it is a message about a step you have scrolled away from. */}
                {step.cases.some((_, index) => duplicate(index)) ? (
                  <p className="text-destructive text-xs">
                    Two cases spelling the same thing are one case. Rename or remove one.
                  </p>
                ) : null}
              </>
            }
          />
        ) : null}

        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Model, system prompt, context
          </summary>
          <FieldRow
            className="mt-3"
            perRow={3}
            content={
              <>
                <FormField
                  label="Model"
                  // The function form, because a Radix `Select` renders no DOM of its own and the
                  // id has to reach the trigger.
                  control={(wired) => (
                    <ModelSelect
                      {...wired}
                      value={step.model}
                      onChange={(model) => patch({ model })}
                      defaultLabel="Same as the task"
                    />
                  )}
                />
                <FormField
                  label="System prompt"
                  control={
                    <Input
                      value={step.systemPrompt}
                      onChange={(event) => patch({ systemPrompt: event.target.value })}
                      placeholder="(same as the task)"
                    />
                  }
                />
                <FormField
                  label="Sees"
                  control={(wired) => (
                    <Select
                      value={step.context}
                      onValueChange={(context) => patch({ context: context as StepContext })}
                    >
                      <SelectTrigger {...wired} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTEXTS.map((context) => (
                          <SelectItem key={context} value={context}>
                            {CONTEXT_LABELS[context]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </>
            }
          />
        </details>

        {decision
          ? arms.map((arm, index) => (
              // Keyed by position: two cases can briefly share a name while one is being typed.
              // biome-ignore lint/suspicious/noArrayIndexKey: the arms follow `cases` positionally
              <div key={index} className="border-l-2 pl-3">
                <p className="mb-2 font-mono text-xs text-muted-foreground">
                  {arm.case === DEFAULT_BRANCH
                    ? "default — anything else"
                    : arm.case || "(unnamed)"}
                </p>
                <StepList
                  steps={arm.steps}
                  depth={depth + 1}
                  onChange={(steps) => setArm(arm.case, steps)}
                />
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
