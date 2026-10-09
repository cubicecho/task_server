/**
 * Which MCP hook events this server fires, in the one place both halves of the app can read it.
 *
 * The pool knows every event a host might fire and cannot know which ones this host does. The
 * server refuses a hook bound to one it never fires when the row is saved, and the form refuses it
 * as it is typed; written in both, they agreed until one was reworded.
 *
 * Imports the pool's browser entry and nothing else: this is read by `server/`, which runs under
 * Node's type stripping, and by `web/`, which is bundled for a browser.
 */
import { HOOK_EVENTS, type HookEvent, type ToolHook } from "@cubicecho/agent-mcp-pool/hooks";

/** A step starts from nothing and nothing is ever compacted, so nothing ever fires this. */
const NEVER_FIRED: HookEvent = "beforeCompact";

/** What task-server fires, in the order the pool lists them. */
export const HOOK_EVENTS_FIRED: readonly HookEvent[] = HOOK_EVENTS.filter(
  (event) => event !== NEVER_FIRED,
);

/**
 * One refusal per hook bound to an event that never fires here. Takes entries that may not be
 * hooks at all, since the server asks before it knows the rest of the row is sound.
 */
export const unfiredProblems = (hooks: readonly Partial<ToolHook>[]): string[] =>
  hooks.flatMap((hook) =>
    hook?.on === NEVER_FIRED
      ? [`hook "${hook.id}": task-server never compacts, so ${NEVER_FIRED} never fires`]
      : [],
  );
