import type { ElicitHandler, ElicitRequestParams } from "@cubicecho/agent-mcp-pool";
import type { ElicitationNote } from "../../shared/elicitations.ts";

/** How much of a server's question a note keeps: a question, not a document. */
const MAX_MESSAGE_CHARS = 500;

/**
 * The note for one question a tool call's server asked.
 *
 * The server is named by the tool's slug rather than the row id the pool hands the handler: the
 * slug is what the operator reads on every other line of a run, and `<slug>__` is the one part of
 * a tool name the pool guarantees.
 */
export function elicitationNote(tool: string, params: ElicitRequestParams): ElicitationNote {
  const cut = tool.indexOf("__");
  const message =
    params.message.length > MAX_MESSAGE_CHARS
      ? `${params.message.slice(0, MAX_MESSAGE_CHARS)}…`
      : params.message;
  return {
    tool,
    server: cut > 0 ? tool.slice(0, cut) : tool,
    message,
    fields: "requestedSchema" in params ? Object.keys(params.requestedSchema.properties ?? {}) : [],
  };
}

/**
 * The `onElicit` for one tool call: every question is declined, and said.
 *
 * Declined rather than cancelled, and the capability declared rather than withheld: `decline` is
 * the spec's "the user saw this and said no", which a server can answer with a default or a clear
 * error, where a client that never offered leaves it guessing. A run has nobody to show a form to
 * — see `DECLINED_BECAUSE` — so the operator is told instead, on the step, that the task needs a
 * default it does not have.
 */
export function declineUnattended(
  tool: string,
  onElicitation: (note: ElicitationNote) => void,
): ElicitHandler {
  return (_serverId, params) => {
    onElicitation(elicitationNote(tool, params));
    return { action: "decline" };
  };
}
