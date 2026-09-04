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
