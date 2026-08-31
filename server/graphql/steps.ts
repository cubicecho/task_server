import { and, eq, inArray, notInArray } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { db } from "../db/client.ts";
import { isPostgres } from "../db/dialect.ts";
import { steps } from "../db/schema.ts";
import { DEFAULT_BRANCH, MAX_DEPTH, MAX_STEPS } from "../runner/flow.ts";

/**
 * Writing a task's flow: one call that replaces the whole tree.
 *
 * A flow is only correct as a whole — a step's parent, the arm it sits in and its place in that
 * arm are all relative to its siblings — so the generated per-row CRUD cannot express an edit
 * to it. With `nestedWrites` off (see `schema.ts`) the editor would otherwise have to issue a
 * mutation per step and hope none of them failed halfway.
 *
 * Everything is validated before anything is written, and the write is one transaction, so a
 * rejected flow leaves the task exactly as it was.
 */

export interface StepBranchInput {
  case: string;
  steps: StepInput[];
}

export interface StepInput {
  id?: string | null;
  kind?: string | null;
  name?: string | null;
  prompt: string;
  cases?: string[] | null;
  model?: string | null;
  systemPrompt?: string | null;
  context?: string | null;
  enabled?: boolean | null;
  branches?: StepBranchInput[] | null;
}

type NewStep = typeof steps.$inferInsert & { id: string };

const KINDS = ["agent", "decision"] as const;
const CONTEXTS = ["all", "previous", "none"] as const;

const reject = (message: string): never => {
  // A plain Error reaches the client as "Internal server error"; every one of these is
  // something the client got wrong and can fix.
  throw new GraphQLError(message, { extensions: { code: "BAD_STEPS" } });
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Flattens the nested input into rows, assigning `parentId`, `branch` and `position`.
 *
 * Pre-order, so a parent is always written before the children that reference it — SQLite
 * checks foreign keys as each row goes in, not at the end of the transaction.
 */
export function flattenSteps(taskId: string, input: StepInput[]): NewStep[] {
  const rows: NewStep[] = [];
  const ids = new Set<string>();

  const walk = (list: StepInput[], parentId: string | null, branch: string, depth: number) => {
    if (depth > MAX_DEPTH) reject(`Steps cannot nest more than ${MAX_DEPTH} deep.`);

    list.forEach((item, index) => {
      if (rows.length >= MAX_STEPS) reject(`A task cannot have more than ${MAX_STEPS} steps.`);

      const kind = KINDS.find((option) => option === (item.kind ?? "agent"));
      if (!kind) reject(`Unknown step kind "${item.kind}" — expected ${KINDS.join(" or ")}.`);
      const context = CONTEXTS.find((option) => option === (item.context ?? "all"));
      if (!context) {
        reject(`Unknown context "${item.context}" — expected one of ${CONTEXTS.join(", ")}.`);
      }

      const name = (item.name ?? "").trim();
      const label = name || `step ${rows.length + 1}`;
      const prompt = item.prompt.trim();
      if (!prompt) reject(`${label} has no prompt.`);

      const id = (item.id ?? "").trim() || crypto.randomUUID();
      if (ids.has(id)) reject(`${label} reuses the id of another step in the same flow.`);
      ids.add(id);

      const cases = (item.cases ?? []).map((option) => option.trim()).filter(Boolean);
      if (kind === "decision" && cases.length === 0) {
        reject(`${label} is a decision with no cases to choose between.`);
      }
      if (kind !== "decision" && (item.branches?.length ?? 0) > 0) {
        reject(`${label} is not a decision, so it cannot have branches.`);
      }
      if (cases.some((option, at) => cases.some((other, i) => i < at && same(option, other)))) {
        reject(`${label} declares the same case twice.`);
      }

      rows.push({
        id,
        taskId,
        parentId,
        branch,
        position: index,
        kind,
        name,
        prompt,
        cases: kind === "decision" ? cases : null,
        model: (item.model ?? "").trim(),
        systemPrompt: item.systemPrompt ?? "",
        context: context as (typeof CONTEXTS)[number],
        enabled: item.enabled ?? true,
      });

      const taken = new Set<string>();
      for (const arm of item.branches ?? []) {
        // The stored `branch` has to be the exact string the decision will answer with, or the
        // runner will look up an arm that is not there.
        const declared = cases.find((option) => same(option, arm.case));
        const resolved = declared ?? (same(arm.case, DEFAULT_BRANCH) ? DEFAULT_BRANCH : undefined);
        if (!resolved) {
          reject(
            `${label} has a branch for "${arm.case}", which is not one of its cases ` +
              `(${cases.join(", ")}) or "${DEFAULT_BRANCH}".`,
          );
        }
        if (taken.has(resolved as string)) reject(`${label} has two branches for "${arm.case}".`);
        taken.add(resolved as string);
        walk(arm.steps ?? [], id, resolved as string, depth + 1);
      }
    });
  };

  walk(input, null, "", 0);
  return rows;
}

/**
 * The statements that turn a task's steps into `rows`, in the order they have to run.
 *
 * The parents are broken first because deleting a step cascades to its children, and a step
 * being *moved* out of a branch would otherwise be deleted along with the branch it left.
 * Surviving rows are updated in place rather than deleted and recreated, so a step that lives
 * through an edit keeps its id — and with it the `run_steps` rows of every past run that point
 * at it.
 */
type Writer = Pick<typeof db, "update" | "delete" | "insert">;

function statements(tx: Writer, taskId: string, rows: NewStep[]) {
  const keep = rows.map((row) => row.id);

  return [
    tx.update(steps).set({ parentId: null }).where(eq(steps.taskId, taskId)),
    tx
      .delete(steps)
      .where(
        keep.length
          ? and(eq(steps.taskId, taskId), notInArray(steps.id, keep))
          : eq(steps.taskId, taskId),
      ),
    ...rows.map((row) => {
      const { id: _id, taskId: _taskId, ...set } = row;
      return tx.insert(steps).values(row).onConflictDoUpdate({ target: steps.id, set });
    }),
  ];
}

/**
 * Replaces a task's steps with these, all of it or none of it.
 *
 * The two dialects part company here and nowhere else in the server: node:sqlite is
 * synchronous, so its transaction commits when the callback *returns* and an awaited statement
 * inside one would land after the commit; postgres is asynchronous and each statement has to be
 * awaited to have run at all. The statements themselves are the same either way.
 */
export async function writeTaskSteps(taskId: string, rows: NewStep[]): Promise<void> {
  if (isPostgres) {
    // `db` carries the SQLite types (see `db/schema.ts`), and drizzle's sync-driver typing
    // rejects an async transaction callback outright — which is the only kind postgres accepts.
    const async = db as unknown as {
      transaction: (callback: (tx: Writer) => Promise<void>) => Promise<void>;
    };
    await async.transaction(async (tx) => {
      for (const statement of statements(tx, taskId, rows)) await statement;
    });
    return;
  }

  db.transaction((tx) => {
    for (const statement of statements(tx, taskId, rows)) statement.run();
  });
}

/** Ids the client supplied that already belong to somebody else. */
export async function foreignIds(taskId: string, rows: NewStep[]): Promise<string[]> {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const existing = await db
    .select({ id: steps.id, taskId: steps.taskId })
    .from(steps)
    .where(inArray(steps.id, ids));
  return existing.filter((row) => row.taskId !== taskId).map((row) => row.id);
}
