/**
 * What an MCP server asked for mid-call, as `run_steps.elicitations` keeps it.
 *
 * In the one place both halves read it, for `shared/server-logs.ts`'s reason: the runner writes
 * the notes and says each one on the run stream, and the run page draws them, and the sentence
 * should read the same in both. Nothing in here may import anything, for the same reason.
 */

/**
 * Why every question is declined. A run is started by a schedule, a webhook or a person who has
 * since looked away, and nothing on its stream can answer a form — so the server is told there is
 * no one to ask, which it can act on, rather than left with a client that never offered.
 */
export const DECLINED_BECAUSE = "task-server runs unattended";

/**
 * The most a step keeps. A server that asks again each time it is declined, inside a tool loop,
 * is asking one question many times, and the operator reading the step wants the question once.
 * Past the cap the asks still reach the run stream as notices.
 */
export const MAX_STEP_ELICITATIONS = 20;

/** One `elicitation/create` a step's tool call caused, and was answered `decline`. */
export interface ElicitationNote {
  /** The tool whose call asked, as the model named it: `<slug>__<tool>`. */
  tool: string;
  /** The server's slug: what the operator knows it by. */
  server: string;
  /** The question, in the server's words, cut to a line's worth. */
  message: string;
  /**
   * The names of the fields the form asked for — the defaults a task would have to carry for
   * this question not to be asked. Empty for a question with no form.
   */
  fields: string[];
}

/** The note as one sentence: what the run stream said and the run page shows. */
export function describeElicitation(note: ElicitationNote): string {
  const fields = note.fields.length ? ` (fields: ${note.fields.join(", ")})` : "";
  return `server ${note.server} asked: ${note.message}${fields} — declined: ${DECLINED_BECAUSE}`;
}
