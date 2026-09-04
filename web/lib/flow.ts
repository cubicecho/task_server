import type { StepFieldsFragment, StepInput } from "@/__generated__/graphql/graphql";
import {
  CONTEXTS,
  DEFAULT_BRANCH,
  KINDS,
  MAX_DEPTH,
  type StepContext,
  type StepKind,
  sameCase,
} from "../../shared/flow.ts";

/**
 * A task's flow, as the editor holds it.
 *
 * The server stores the steps flat — each one naming its parent and the arm it sits in — and
 * takes them back as a tree. This is where the two shapes meet: `toDraft` on the way in, `toInput`
 * on the way out.
 */

export type { StepContext, StepKind };
// Shared with the server rather than mirrored: the editor stops offering what the server would
// refuse, and that only holds while there is one copy of the numbers.
export { CONTEXTS, DEFAULT_BRANCH, KINDS, MAX_DEPTH, sameCase };

export interface DraftBranch {
  case: string;
  steps: DraftStep[];
}

export interface DraftStep {
  /** React's key, stable across every edit — an unsaved step has one of these and no `id`. */
  key: string;
  /** The row this came from, sent back so the server edits it in place. Absent when new. */
  id?: string;
  kind: StepKind;
  name: string;
  prompt: string;
  cases: string[];
  model: string;
  systemPrompt: string;
  context: StepContext;
  enabled: boolean;
  branches: DraftBranch[];
}

let counter = 0;
const nextKey = () => `draft-${++counter}`;

export function emptyStep(kind: StepKind): DraftStep {
  return {
    key: nextKey(),
    kind,
    name: "",
    prompt: "",
    cases: kind === "decision" ? ["yes", "no"] : [],
    model: "",
    systemPrompt: "",
    context: "all",
    enabled: true,
    branches:
      kind === "decision"
        ? [
            { case: "yes", steps: [] },
            { case: "no", steps: [] },
          ]
        : [],
  };
}

const asKind = (value: unknown): StepKind => KINDS.find((kind) => kind === value) ?? "agent";
const asContext = (value: unknown): StepContext =>
  CONTEXTS.find((context) => context === value) ?? "all";

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];

/** The flat rows, back into the tree they describe. */
export function toDraft(rows: readonly StepFieldsFragment[]): DraftStep[] {
  const drafts = new Map<string, DraftStep>();
  for (const row of rows) {
    drafts.set(row.id, {
      key: row.id,
      id: row.id,
      kind: asKind(row.kind),
      name: row.name,
      prompt: row.prompt,
      cases: asStrings(row.cases),
      model: row.model,
      systemPrompt: row.systemPrompt,
      context: asContext(row.context),
      enabled: row.enabled,
      branches: [],
    });
  }

  const roots: DraftStep[] = [];
  // The query orders by `position`, so appending keeps every sequence in its own order.
  for (const row of rows) {
    const draft = drafts.get(row.id);
    if (!draft) continue;
    const parent = row.parentId ? drafts.get(row.parentId) : undefined;
    if (!parent) {
      // A step whose parent is missing has nowhere to sit; the runner drops it too.
      if (!row.parentId) roots.push(draft);
      continue;
    }
    const arm = parent.branches.find((branch) => branch.case === row.branch);
    if (arm) arm.steps.push(draft);
    else parent.branches.push({ case: row.branch, steps: [draft] });
  }

  // A declared case with nothing under it still deserves a place to drop something into.
  for (const draft of drafts.values()) {
    if (draft.kind !== "decision") continue;
    for (const label of draft.cases) {
      if (!draft.branches.some((branch) => branch.case === label)) {
        draft.branches.push({ case: label, steps: [] });
      }
    }
    draft.branches.sort((a, b) => armOrder(draft, a) - armOrder(draft, b));
  }
  return roots;
}

/** Arms read in the order their cases were declared, with `default` last. */
const armOrder = (step: DraftStep, branch: DraftBranch) => {
  const at = step.cases.indexOf(branch.case);
  return at === -1 ? step.cases.length : at;
};

/** The tree, as the mutation takes it. Empty arms are dropped; empty steps are not. */
export function toInput(steps: readonly DraftStep[]): StepInput[] {
  return steps.map((step) => ({
    ...(step.id ? { id: step.id } : {}),
    kind: step.kind,
    name: step.name.trim(),
    prompt: step.prompt,
    ...(step.kind === "decision" ? { cases: step.cases.map((label) => label.trim()) } : {}),
    model: step.model,
    systemPrompt: step.systemPrompt,
    context: step.context,
    enabled: step.enabled,
    ...(step.kind === "decision"
      ? {
          branches: step.branches
            .filter((branch) => branch.steps.length > 0)
            .map((branch) => ({ case: branch.case, steps: toInput(branch.steps) })),
        }
      : {}),
  }));
}
