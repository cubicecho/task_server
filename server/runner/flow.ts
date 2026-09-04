import { eq } from "drizzle-orm";
import { errorMessage } from "../../shared/errors.ts";
import { DEFAULT_BRANCH, MAX_DEPTH, MAX_STEPS } from "../../shared/flow.ts";
import { db } from "../db/client.ts";
import { type RunStep, runSteps, type Settings, type Step, type Task } from "../db/schema.ts";
import { runAgent } from "./agent.ts";
import type { RunEventInput } from "./events.ts";
import { ask, parseJson, tryAsk } from "./side-task.ts";

/**
 * A task as a flow: its prompt, then a tree of steps under it.
 *
 * One prompt is enough to summarise a build. It is not enough for the thing people actually
 * want from an automation — *do something, look at what came back, then do one of several
 * things* — and that is what this adds. A **sequence** is steps one after another, each shown
 * what the ones before it produced. A **decision** is a step that also picks which of its arms
 * runs next, and an arm is itself a sequence, so the whole thing nests.
 *
 * A decision is a full agent run, tools and all: deciding whether the last five emails contain
 * an application error may well mean going and reading them. What separates it from an ordinary
 * step is only that its final answer has to land on one of the arms it declared.
 *
 * Nothing here loops: the flow is a tree, walked depth-first, and each step's own tool loop is
 * bounded by `settings.maxToolIterations` as before.
 */

// The editor enforces the same three, so they live where both halves can read them, and are
// re-exported here because this is the module the rest of the server already asks.
export { DEFAULT_BRANCH, MAX_DEPTH, MAX_STEPS };

export interface FlowNode {
  step: Step;
  /** Children by the arm they sit in. */
  branches: Map<string, FlowNode[]>;
}

/** What a step produced, under the name the next step refers to it by. */
export interface ContextEntry {
  name: string;
  output: string;
}

export interface FlowResult {
  output: string;
  toolCalls: { name: string; ok: boolean }[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Builds the tree from the flat rows.
 *
 * A row whose `parentId` names a step that is not here — deleted, or belonging to another task
 * — is dropped rather than failing the run, and so is one that can be reached only by going
 * round in a circle. Neither should be possible through `setTaskSteps`, but the tables are also
 * writable directly, and a malformed row is not worth a task that can never run again.
 */
export function buildTree(rows: Step[]): FlowNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));

  const rooted = rows.filter((row) => {
    const seen = new Set<string>();
    let current: Step | undefined = row;
    while (current?.parentId) {
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      current = byId.get(current.parentId);
      if (!current) return false;
    }
    return current !== undefined;
  });

  const nodes = new Map<string, FlowNode>(
    rooted.map((row) => [row.id, { step: row, branches: new Map<string, FlowNode[]>() }]),
  );

  const roots: FlowNode[] = [];
  // `position` is what the editor writes; the tie-breaks only matter for rows written by hand,
  // and exist so the same table always produces the same tree.
  const ordered = [...rooted].sort(
    (a, b) =>
      a.position - b.position ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );

  for (const row of ordered) {
    const node = nodes.get(row.id);
    if (!node) continue;
    if (!row.parentId) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(row.parentId);
    if (!parent) continue;
    const arm = parent.branches.get(row.branch) ?? [];
    arm.push(node);
    parent.branches.set(row.branch, arm);
  }
  return roots;
}

/** What a prompt can ask for by hand: `{{previous}}`, `{{steps.<name>}}` and `{{event}}`. */
const PLACEHOLDER = /\{\{\s*(previous|event|steps\.[^}]+?)\s*\}\}/gi;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The webhook body as a prompt reads it.
 *
 * Pretty-printed rather than compact: the model is being asked to read it, and the indentation
 * is what makes a nested body legible to one. Null covers both a run no webhook started and a
 * delivery whose body could not be kept — neither has a payload, and the prompt only needs to
 * know that it is not there.
 */
function renderPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "(this run has no event payload)";
  return JSON.stringify(payload, null, 2);
}

/**
 * The user message a step is sent: what came before it, then what it was asked to do.
 *
 * By default the earlier outputs are a preamble above the prompt, as much of them as the step's
 * `context` mode allows. A prompt that names what it wants — "write an md file containing
 * {{previous}}" — gets the substitution instead and no preamble, because it has said where the
 * data belongs and repeating it above would only be a second copy for the model to reconcile.
 *
 * `{{event}}` is the exception to that: it is the webhook body, which is not step context at
 * all, so placing it says nothing about where the earlier outputs go and does not suppress the
 * preamble. A prompt can ask for both and get both.
 */
export function renderPrompt(
  step: Pick<Step, "prompt" | "context">,
  context: ContextEntry[],
  payload?: unknown,
): string {
  // One pass says both whether the prompt places its own context and what that reads as —
  // `test` on a global regex would leave `lastIndex` behind for the next call to trip over.
  let placed = false;
  const substituted = step.prompt.replace(PLACEHOLDER, (_match, token: string) => {
    const key = token.toLowerCase();
    if (key === "event") return renderPayload(payload);
    placed = true;
    if (key === "previous") return context[context.length - 1]?.output ?? "";
    const wanted = token.slice("steps.".length);
    const entry = context.find((item) => sameName(item.name, wanted));
    // Saying so beats substituting an empty string and leaving the model to invent the rest.
    return entry ? entry.output : `(no step named "${wanted.trim()}" has run)`;
  });
  if (placed) return substituted;

  // `substituted` from here down, not `step.prompt`: `{{event}}` leaves the preamble standing
  // but has still been replaced, and putting the raw prompt back would undo it.
  const visible =
    step.context === "none" ? [] : step.context === "previous" ? context.slice(-1) : context;
  if (visible.length === 0) return substituted;

  const earlier = visible.map((entry) => `### ${entry.name}\n\n${entry.output}`).join("\n\n");
  return `## Earlier in this task\n\n${earlier}\n\n---\n\n${substituted}`;
}

/** The instruction that turns an ordinary agent run into an answer this can act on. */
export function decisionInstruction(cases: string[]): string {
  return (
    "When you have what you need, end your reply with exactly one line, and nothing after it:\n" +
    `{"case": "<one of: ${cases.join(", ")}>"}`
  );
}

/**
 * Reads the arm out of a decision's reply.
 *
 * The trailing JSON line is what was asked for and what usually arrives, so it is looked for
 * last-first — a model that reasons out loud may well have written the word "error" several
 * times before choosing "clean". A bare label on the final line is accepted too; models that
 * cannot be talked out of answering in prose still tend to end on the answer.
 */
export function parseCase(output: string, cases: string[]): string | undefined {
  const match = (value: string) => cases.find((option) => sameName(option, value));

  const objects = output.match(/\{[^{}]*"case"[^{}]*\}/g);
  for (const candidate of objects?.reverse() ?? []) {
    const parsed = parseJson<{ case?: unknown }>(candidate);
    if (typeof parsed?.case === "string") {
      const found = match(parsed.case);
      if (found) return found;
    }
  }

  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.reverse()) {
    // A final line is an answer, not a sentence: strip the punctuation a model wraps it in.
    const bare = line.replace(/^[`"'*\s]+|[`"'*.,!\s]+$/g, "");
    const found = match(bare);
    if (found) return found;
  }
  return undefined;
}

/** One step as the runner sees it: a row from the tree, or the task's own prompt. */
interface Plan {
  stepId: string | null;
  name: string;
  kind: "agent" | "decision";
  prompt: string;
  /**
   * Decision only: the answers this step may give. That is the arms it declared, plus
   * `default` — but only when a `default` arm actually has something in it, because there is
   * no point offering the model a way out that leads nowhere.
   */
  cases: string[];
  model: string;
  systemPrompt: string;
  context: Step["context"];
  depth: number;
}

export interface FlowOptions {
  runId: string;
  task: Task;
  steps: Step[];
  /** The settings row with the task's agent profile laid over it. See `runner/profile.ts`. */
  config: Settings;
  /** The profile's MCP scope, passed to every step's turn. Undefined is every server. */
  servers?: ReadonlySet<string>;
  /** The body of the webhook that started this run, for `{{event}}`. See `renderPayload`. */
  payload?: unknown;
  signal?: AbortSignal;
  onEvent?: (event: RunEventInput) => void;
}

/**
 * Runs a task's flow to completion and returns the rollup for its run row.
 *
 * Every step it executes leaves a `run_steps` row behind, including the task's own prompt, so
 * the history reads the same for a one-prompt task as for a branching one. A step that throws
 * is recorded before the throw is passed on, which is what lets `run.ts` write the run's
 * outcome without knowing anything about steps.
 */
export async function runFlow({
  runId,
  task,
  steps,
  config,
  servers,
  payload,
  signal,
  onEvent,
}: FlowOptions): Promise<FlowResult> {
  const context: ContextEntry[] = [];
  const result: FlowResult = {
    output: "",
    toolCalls: [],
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  /** Where in the run's history the next row goes — skipped steps take a place in it too. */
  let position = 0;
  /** How many steps have actually run, which is what the cap is about. */
  let executed = 0;

  /** Stamps everything a step says with the step it said it in, for whoever is watching. */
  const scope =
    (name: string) =>
    (event: RunEventInput): void =>
      onEvent?.({ ...event, step: event.step ?? name });

  async function record(plan: Plan, status: RunStep["status"]): Promise<RunStep> {
    const [row] = await db
      .insert(runSteps)
      .values({
        runId,
        stepId: plan.stepId,
        position: position++,
        depth: plan.depth,
        name: plan.name,
        kind: plan.kind,
        status,
        // Only a step that is going to run has an end to wait for.
        ...(status === "running" ? {} : { finishedAt: new Date() }),
      })
      .returning();
    return row;
  }

  const close = (id: string, patch: Partial<RunStep>) =>
    db
      .update(runSteps)
      .set({ ...patch, finishedAt: new Date() })
      .where(eq(runSteps.id, id));

  /** Runs one step, records it, and returns the arm to take next if it was a decision. */
  async function execute(plan: Plan): Promise<string | undefined> {
    if (executed >= MAX_STEPS) {
      throw new Error(`Stopped after ${MAX_STEPS} steps — check the task for a runaway branch.`);
    }
    if (plan.kind === "decision" && plan.cases.length === 0) {
      throw new Error(`Decision "${plan.name}" has no arms to choose between.`);
    }
    signal?.throwIfAborted();

    const emit = scope(plan.name);
    const row = await record(plan, "running");
    executed++;
    emit({ kind: "step", name: plan.name, text: plan.kind });

    const systemPrompt = plan.systemPrompt || task.systemPrompt || config.systemPrompt || "";

    try {
      const agentResult = await runAgent({
        config,
        model: plan.model || task.model || config.model,
        systemPrompt:
          plan.kind === "decision"
            ? `${systemPrompt}\n\n${decisionInstruction(plan.cases)}`.trim()
            : systemPrompt,
        prompt: renderPrompt(plan, context, payload),
        servers,
        signal,
        onEvent: emit,
      });

      result.toolCalls.push(...agentResult.toolCalls);
      result.promptTokens += agentResult.promptTokens;
      result.completionTokens += agentResult.completionTokens;
      result.totalTokens += agentResult.totalTokens;
      result.output = agentResult.output;
      context.push({ name: plan.name, output: agentResult.output });

      const tokens = {
        toolCalls: agentResult.toolCalls,
        promptTokens: agentResult.promptTokens,
        completionTokens: agentResult.completionTokens,
        totalTokens: agentResult.totalTokens,
      };

      if (plan.kind !== "decision") {
        await close(row.id, { status: "ok", output: agentResult.output, ...tokens });
        return undefined;
      }

      const branch = await resolveCase(plan, agentResult.output, emit);
      emit({ kind: "decision", name: plan.name, text: branch });
      await close(row.id, { status: "ok", output: agentResult.output, branch, ...tokens });
      return branch;
    } catch (error) {
      const stopped = signal?.aborted === true;
      await close(row.id, {
        status: stopped ? "stopped" : "error",
        error: stopped ? "" : errorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Turns a decision's reply into one of its arms.
   *
   * The reply is read first; a model that answered in prose gets one cheap extraction call to
   * say which arm it meant. Only when neither lands does `default` come into it, and a decision
   * with no `default` fails the run rather than quietly running nothing — a branch that silently
   * does nothing is the worst outcome to have to debug.
   */
  async function resolveCase(
    plan: Plan,
    output: string,
    emit: (event: RunEventInput) => void,
  ): Promise<string> {
    const direct = parseCase(output, plan.cases);
    if (direct) return direct;

    const extracted = await tryAsk("decision", () =>
      ask(
        config,
        config.toolSelectModel || plan.model || task.model || config.model,
        `Which of these did the following answer choose? Reply with exactly one of: ${plan.cases.join(", ")}. Nothing else.`,
        output,
        { maxTokens: 32, signal },
      ),
    );
    const guessed = extracted ? parseCase(extracted, plan.cases) : undefined;
    if (guessed) {
      emit({ kind: "notice", text: `decision "${plan.name}" read back as ${guessed}` });
      return guessed;
    }

    if (plan.cases.some((option) => sameName(option, DEFAULT_BRANCH))) {
      emit({ kind: "notice", text: `decision "${plan.name}" fell through to ${DEFAULT_BRANCH}` });
      return DEFAULT_BRANCH;
    }
    throw new Error(
      `Decision "${plan.name}" did not answer with one of: ${plan.cases.join(", ")}. ` +
        `Give it a "${DEFAULT_BRANCH}" arm if it should be allowed to fall through.`,
    );
  }

  async function runSequence(nodes: FlowNode[], depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      throw new Error(`Steps are nested more than ${MAX_DEPTH} deep.`);
    }
    for (const node of nodes) {
      const { step } = node;
      const plan = toPlan(node, step.name.trim() || `step ${position + 1}`, depth);

      if (!step.enabled) {
        await record(plan, "skipped");
        continue;
      }

      const branch = await execute(plan);
      if (branch === undefined) continue;
      // An arm with nothing in it is a legitimate "then do nothing"; only an unanswerable
      // decision is a failure, and `resolveCase` has already thrown by here if it was one.
      await runSequence(node.branches.get(branch) ?? [], depth + 1);
    }
  }

  // The task's own prompt is the first step, and always was. Everything in `steps` is what
  // happens after it, which is why it has no row of its own to point at.
  await execute({
    stepId: null,
    name: task.name.trim() || "task",
    kind: "agent",
    prompt: task.prompt,
    cases: [],
    model: task.model,
    systemPrompt: task.systemPrompt,
    context: "none",
    depth: 0,
  });

  await runSequence(buildTree(steps), 0);
  return result;
}

function toPlan(node: FlowNode, name: string, depth: number): Plan {
  const { step } = node;
  const declared = (step.cases ?? []).map((option) => option.trim()).filter(Boolean);
  // `default` is offered only when there is a `default` arm to run. Telling a model it may
  // answer "default" and then having nowhere to go is how a decision silently does nothing.
  const hasDefault = (node.branches.get(DEFAULT_BRANCH)?.length ?? 0) > 0;
  return {
    stepId: step.id,
    name,
    kind: step.kind,
    prompt: step.prompt,
    cases: hasDefault ? [...declared, DEFAULT_BRANCH] : declared,
    model: step.model,
    systemPrompt: step.systemPrompt,
    context: step.context,
    depth,
  };
}
