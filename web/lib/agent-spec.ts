/**
 * The browser's half of moving a profile between hosts: what the file is called and what is in
 * it. The document itself is the server's — `agentSpec` writes it and nothing here edits it.
 */

/** The suffix the format's own tooling looks for. */
const SUFFIX = ".agent.json";

/**
 * The file a profile is saved as.
 *
 * A name is whatever somebody typed, and a file name is not: a slash is a directory to every
 * browser's save dialog, and a leading dot is a file nobody finds again. Runs of anything that
 * is not a letter, a digit, a dot, a dash or an underscore become one dash, and a name with
 * nothing left of it is still a file.
 */
export function specFileName(name: string): string {
  const stem = name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${stem || "agent"}${SUFFIX}`;
}

/** The document as a file a person can read and diff: indented, and ending in a newline. */
export const specText = (spec: unknown): string => `${JSON.stringify(spec, null, 2)}\n`;

/**
 * Hands the browser a file to save.
 *
 * There is no request to make — the text is already here — so the link is made, clicked and
 * thrown away, and the object URL with it, which otherwise holds the text for the life of the
 * page.
 */
export function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
