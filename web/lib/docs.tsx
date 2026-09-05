import { Fragment, type ReactNode } from "react";
import { type FieldDescriptionMap, FieldDescriptions } from "@/__generated__/graphql/descriptions";

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
 * A schema description with its backticks rendered.
 *
 * These sentences are written once and read by two audiences, so they are marked up the only way
 * both understand: a model reads `` `ondemand` `` as markdown, and this turns it into a `<code>`
 * for everyone else. It lives beside `describe` because every caller of one wants the other.
 */
export function ticks(text: string): ReactNode {
  return text.split("`").map((part, index) =>
    index % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the split of a fixed string is the order
      <code key={index}>{part}</code>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: same
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/**
 * `describe` bound to one type and rendered, for a form that is mostly one table.
 *
 * `settings.tsx` names fourteen fields of `Setting` and would otherwise repeat the type name at
 * every one of them.
 */
export const describeFor =
  <T extends keyof FieldDescriptionMap>(type: T) =>
  (field: keyof FieldDescriptionMap[T]): ReactNode =>
    ticks(describe(type, field));
