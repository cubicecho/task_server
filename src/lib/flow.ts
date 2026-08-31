import { parse, stringify } from "yaml";
import type { StepFieldsFragment, StepInput } from "@/gql/graphql";

/**
 * A task's flow, as the editor holds it.
 *
 * The server stores the steps flat — each one naming its parent and the arm it sits in — and
 * takes them back as a tree. In between, both the builder and the text editor want the tree, so
 * this is where the two shapes meet: `toDraft` on the way in, `toInput` on the way out, and the
 * YAML pair for the tab that edits the whole thing as text.
 */

export const KINDS = ["agent", "decision"] as const;
export const CONTEXTS = ["all", "previous", "none"] as const;
export const DEFAULT_BRANCH = "default";
/** Mirrors `server/runner/flow.ts` — the editor stops offering what the server would refuse. */
export const MAX_DEPTH = 8;

export type StepKind = (typeof KINDS)[number];
export type StepContext = (typeof CONTEXTS)[number];

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

/**
 * The flow as YAML, with everything left at its default left out.
 *
 * What is written here is what `fromYaml` reads back, so a round trip through the text tab
 * changes nothing — including the ids, which is what keeps a step's run history attached to it
 * when the flow is edited as text.
 */
export function toYaml(steps: readonly DraftStep[]): string {
  const plain = (list: readonly DraftStep[]): unknown[] =>
    list.map((step) => ({
      ...(step.name.trim() ? { name: step.name.trim() } : {}),
      ...(step.kind === "decision" ? { kind: "decision" } : {}),
      prompt: step.prompt,
      ...(step.kind === "decision" ? { cases: step.cases } : {}),
      ...(step.context === "all" ? {} : { context: step.context }),
      ...(step.model ? { model: step.model } : {}),
      ...(step.systemPrompt ? { systemPrompt: step.systemPrompt } : {}),
      ...(step.enabled ? {} : { enabled: false }),
      ...(step.kind === "decision" && step.branches.some((branch) => branch.steps.length)
        ? {
            branches: Object.fromEntries(
              step.branches
                .filter((branch) => branch.steps.length)
                .map((branch) => [branch.case, plain(branch.steps)]),
            ),
          }
        : {}),
      ...(step.id ? { id: step.id } : {}),
    }));

  return steps.length === 0 ? "" : stringify(plain(steps), { lineWidth: 96 });
}

/**
 * YAML — or JSON, which is YAML — back into the tree.
 *
 * Anything it cannot make sense of is thrown with the path to the offending step, because the
 * alternative is a flow that silently loses whatever it did not understand.
 */
export function fromYaml(text: string): DraftStep[] {
  if (!text.trim()) return [];
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  return readSteps(parsed, "the flow");
}

function readSteps(value: unknown, where: string): DraftStep[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${where} should be a list of steps.`);
  return value.map((item, index) => readStep(item, `${where}, step ${index + 1}`));
}

function readStep(value: unknown, where: string): DraftStep {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where} should be a step, with a prompt.`);
  }
  const raw = value as Record<string, unknown>;
  const known = new Set([
    "id",
    "kind",
    "name",
    "prompt",
    "cases",
    "model",
    "systemPrompt",
    "context",
    "enabled",
    "branches",
  ]);
  const unknownKey = Object.keys(raw).find((key) => !known.has(key));
  // A typo in a key is otherwise a setting that silently does nothing.
  if (unknownKey) throw new Error(`${where} has an unknown field "${unknownKey}".`);

  if (raw.kind !== undefined && !KINDS.some((kind) => kind === raw.kind)) {
    throw new Error(`${where} has kind "${String(raw.kind)}" — expected agent or decision.`);
  }
  if (raw.context !== undefined && !CONTEXTS.some((context) => context === raw.context)) {
    throw new Error(
      `${where} has context "${String(raw.context)}" — expected all, previous or none.`,
    );
  }
  if (typeof raw.prompt !== "string" || !raw.prompt.trim()) {
    throw new Error(`${where} has no prompt.`);
  }

  const kind = asKind(raw.kind);
  const cases = asStrings(raw.cases);
  if (kind === "decision" && cases.length === 0) {
    throw new Error(`${where} is a decision, so it needs at least one case.`);
  }

  const branches = readBranches(raw.branches, where, cases);
  // The arms are the cases, whether or not anything has been put in them yet.
  for (const label of cases) {
    if (!branches.some((branch) => branch.case === label))
      branches.push({ case: label, steps: [] });
  }

  return {
    key: nextKey(),
    ...(typeof raw.id === "string" && raw.id ? { id: raw.id } : {}),
    kind,
    name: typeof raw.name === "string" ? raw.name : "",
    prompt: raw.prompt,
    cases,
    model: typeof raw.model === "string" ? raw.model : "",
    systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt : "",
    context: asContext(raw.context),
    enabled: raw.enabled !== false,
    branches,
  };
}

/** `branches` as a map of case to steps, or as the list of `{ case, steps }` the API takes. */
function readBranches(value: unknown, where: string, cases: string[]): DraftBranch[] {
  if (value === null || value === undefined) return [];

  const entries: DraftBranch[] = Array.isArray(value)
    ? value.map((item, index) => {
        const arm = item as { case?: unknown; steps?: unknown };
        const label = typeof arm?.case === "string" ? arm.case : "";
        if (!label) throw new Error(`${where}, branch ${index + 1} does not say which case it is.`);
        return { case: label, steps: readSteps(arm.steps, `${where}, branch "${label}"`) };
      })
    : typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).map(([label, steps]) => ({
          case: label,
          steps: readSteps(steps, `${where}, branch "${label}"`),
        }))
      : (() => {
          throw new Error(`${where} has branches that are neither a list nor a map.`);
        })();

  for (const branch of entries) {
    if (branch.case !== DEFAULT_BRANCH && !cases.includes(branch.case)) {
      throw new Error(
        `${where} has a branch for "${branch.case}", which is not one of its cases ` +
          `(${cases.join(", ") || "none"}) or "${DEFAULT_BRANCH}".`,
      );
    }
  }
  return entries;
}
