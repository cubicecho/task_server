/**
 * The rules of a flow, in the one place both halves of the app can read them.
 *
 * These are not preferences: the editor refuses to nest an arm past `MAX_DEPTH` because the
 * server would reject the flow if it did, and it offers exactly the kinds and context modes the
 * `steps` table has columns for. Written down twice — once here and once over there — they are
 * a pair of numbers that agree until someone changes one of them, and the failure is a flow the
 * editor builds happily and the server will not take.
 *
 * Nothing in here may import anything. It is read by `server/`, which runs under Node's type
 * stripping, and by `src/`, which is bundled for a browser.
 */

/** What a step is. `agent` does the work; `decision` does the work *and* picks the arm next. */
export const KINDS = ["agent", "decision"] as const;

/** How much of the run so far a step is shown before its own prompt. */
export const CONTEXTS = ["all", "previous", "none"] as const;

/** The arm a decision falls to when nothing it declared applies. */
export const DEFAULT_BRANCH = "default";

/** How deep the arms may nest, and how many steps one run may execute. */
export const MAX_DEPTH = 8;
export const MAX_STEPS = 64;

export type StepKind = (typeof KINDS)[number];
export type StepContext = (typeof CONTEXTS)[number];
