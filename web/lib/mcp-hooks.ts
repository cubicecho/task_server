/**
 * The hooks field of the MCP server dialog, checked as it is typed.
 *
 * The pool's own `validateHooks`, from its browser entry — the check the server runs on every
 * write — so a hook the form accepts is not refused a round trip later.
 */
import { type ToolHook, validateHooks } from "@cubicecho/agent-mcp-pool/hooks";
import { unfiredProblems } from "../../shared/hooks.ts";

export const HOOK_PLACEHOLDER = JSON.stringify(
  [
    {
      id: "recall",
      on: "beforeTurn",
      tool: "recall",
      args: { query: "{{prompt}}", scope: "{{vars.task.id}}" },
      inject: true,
    },
  ],
  null,
  2,
);

/** The first thing wrong with the text, or undefined when it could be saved. */
export function hooksProblem(text: string): string | undefined {
  if (!text.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "Hooks is not valid JSON.";
  }
  const [problem] = validateHooks(parsed);
  if (problem) return problem;
  // Past `validateHooks` this is an array of hooks, each bound to a real event.
  return unfiredProblems(parsed as ToolHook[])[0];
}
