/** What the rules below read of a trigger being edited. */
interface TriggerDraft {
  id?: string;
  kind: "cron" | "event";
  cron: string;
  event: string;
}

/** Whether the one value a trigger of this kind cannot do without is missing. */
export const isBlank = (trigger: TriggerDraft) =>
  !(trigger.kind === "cron" ? trigger.cron : trigger.event).trim();

/**
 * Why a trigger cannot be saved as it stands, or nothing.
 *
 * A blank row that was never saved is one somebody added and did not fill in, and the save
 * leaves it out. A blank row that *was* saved is a different thing: the stored trigger still
 * has its schedule or its address, and leaving it out of the save would report success while
 * the old one kept firing. Emptying the box is not a delete — the row has a button for that —
 * so it is refused, and says which of the two the person has to choose.
 */
export function triggerProblem(trigger: TriggerDraft): string | undefined {
  if (!trigger.id || !isBlank(trigger)) return undefined;
  return trigger.kind === "cron"
    ? "A saved schedule needs a cron expression. Remove it to stop it firing."
    : "A saved webhook needs an id. Remove it to stop it firing.";
}
