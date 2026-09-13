/**
 * The hooks field of the MCP server dialog, checked as it is typed.
 *
 * Only the shape: the pool's `validateHooks` lives in a package the browser cannot import, and
 * the server runs it on every write and refuses with the problems named. What is caught here is
 * what makes that refusal a round trip for a missing bracket.
 */

/** What task-server fires. `beforeCompact` is missing on purpose: a run never compacts. */
export const HOOK_EVENTS = [
  "sessionStart",
  "beforeTurn",
  "afterTurn",
  "sessionEnd",
  "sessionDelete",
] as const;

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
  if (!Array.isArray(parsed)) return "Hooks is a JSON array of hooks.";
  for (const [index, hook] of parsed.entries()) {
    const entry = hook as Record<string, unknown> | null;
    const name = typeof entry?.id === "string" && entry.id ? `"${entry.id}"` : `#${index + 1}`;
    if (!entry || typeof entry !== "object") return `Hook ${name} is not an object.`;
    if (typeof entry.id !== "string" || !entry.id) return `Hook ${name} needs an id.`;
    if (typeof entry.tool !== "string" || !entry.tool) return `Hook ${name} needs a tool.`;
    if (!HOOK_EVENTS.includes(entry.on as (typeof HOOK_EVENTS)[number])) {
      return `Hook ${name}: "on" is one of ${HOOK_EVENTS.join(", ")}.`;
    }
  }
  return undefined;
}
