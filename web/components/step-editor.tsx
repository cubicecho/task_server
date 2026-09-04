import { ChevronDown, ChevronUp, GitBranch, Plus, Trash2, X } from "lucide-react";
import { ModelSelect } from "@/components/model-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
          variant="outline"
          size="sm"
          onClick={() => onChange([...steps, emptyStep("agent")])}
        >
          <Plus className="size-4" />
          Add step
        </Button>
        <Button
          variant="outline"
          size="sm"
          // A decision's arms sit one level deeper, and the server refuses past MAX_DEPTH.
          disabled={depth >= MAX_DEPTH}
          title={depth >= MAX_DEPTH ? `Steps cannot nest more than ${MAX_DEPTH} deep.` : undefined}
          onClick={() => onChange([...steps, emptyStep("decision")])}
        >
          <GitBranch className="size-4" />
          Add decision
        </Button>
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
        />
        <Switch
          checked={step.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
          aria-label="Enabled"
          title={step.enabled ? "Runs" : "Skipped"}
        />
        <Button
          variant="ghost"
          size="icon"
          title="Move up"
          disabled={first}
          onClick={() => onMove(-1)}
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Move down"
          disabled={last}
          onClick={() => onMove(1)}
        >
          <ChevronDown className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Remove" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <Textarea
          value={step.prompt}
          onChange={(event) => patch({ prompt: event.target.value })}
          rows={3}
          placeholder={
            decision
              ? "Do any of these report an application error?"
              : "Write what came back to ~/notes/errors.md — {{previous}}"
          }
        />

        {decision ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Cases</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => patch({ cases: [...step.cases, ""] })}
              >
                <Plus className="size-4" />
                Add case
              </Button>
            </div>
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
                    aria-invalid={duplicate(index)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Remove this case"
                    onClick={() => dropCase(index)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            {/* Said here rather than at save time: the server refuses the whole flow over it,
                and by then it is a message about a step you have scrolled away from. */}
            {step.cases.some((_, index) => duplicate(index)) ? (
              <p className="text-xs text-destructive">
                Two cases spelling the same thing are one case. Rename or remove one.
              </p>
            ) : null}
          </div>
        ) : null}

        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Model, system prompt, context
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Model</Label>
              <ModelSelect
                value={step.model}
                onChange={(model) => patch({ model })}
                defaultLabel="Same as the task"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">System prompt</Label>
              <Input
                value={step.systemPrompt}
                onChange={(event) => patch({ systemPrompt: event.target.value })}
                placeholder="(same as the task)"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Sees</Label>
              <Select
                value={step.context}
                onValueChange={(context) => patch({ context: context as StepContext })}
              >
                <SelectTrigger className="w-full">
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
            </div>
          </div>
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
