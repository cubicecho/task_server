import type { ReactNode } from "react";
import { type FieldDescriptionMap, FieldDescriptions } from "@/__generated__/graphql/descriptions";
import { ticks } from "@/components/form-field";

/**
 * The note under a field, read from the schema rather than typed out again here.
 *
 * Every one of these used to be a string literal in the form beside the input it described, and
 * the same sentence — usually a slightly older draft of it — was JSDoc on the column in
 * `server/db/schema.ts`. Neither copy could see the other, so they drifted, and an agent on
 * `/mcp` read neither. `server/graphql/docs.ts` is the one copy now; it reaches the SDL through
 * `describeColumn`, and codegen brings it back here as a map.
 *
 * The pair is checked against the generated map, so renaming a column and regenerating turns a
 * stale reference in a form into a typecheck error rather than a note that quietly disappears.
 */
export function describe<T extends keyof FieldDescriptionMap>(
  type: T,
  field: keyof FieldDescriptionMap[T],
): string {
  const fields: Record<string, string> = FieldDescriptions[type];
  return fields[field as string];
}

/**
 * `describe` bound to one type and rendered, for a form that is mostly one table.
 *
 * `settings.tsx` names fourteen fields of `Setting` and would otherwise repeat the type name at
 * every one of them.
 *
 * The rendering is `ticks` from `form-field`, which is the registry's now: a description written
 * for a model and a person at once is not this app's problem, and the copy that used to live
 * here dropped an unpaired backtick's worth of the sentence on the floor.
 */
export const describeFor =
  <T extends keyof FieldDescriptionMap>(type: T) =>
  (field: keyof FieldDescriptionMap[T]): ReactNode =>
    ticks(describe(type, field));
