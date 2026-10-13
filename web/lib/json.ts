/**
 * Parses a JSON field from a form, naming the field when it will not parse.
 *
 * Several forms here edit a JSON column as text — a half-typed object has to be allowed to sit
 * in the box — so the parse happens on save, and what a person needs back is which box is wrong
 * rather than "unexpected token".
 */
export function parseJson<T>(text: string, field: string, fallback: T): T {
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${field} is not valid JSON.`);
  }
}

/**
 * A JSON column that holds a list of strings, read as one.
 *
 * The scalar carries no shape, so this is where it is checked rather than asserted: null and
 * anything that is not a list come back empty, which is what every such column means by absent.
 */
export const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
