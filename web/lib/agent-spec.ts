/**
 * The browser's half of moving a profile between hosts: what the file is called and what is in
 * it. The document itself is the server's — `agentSpec` writes it and nothing here edits it.
 */

/** The columns a profile overrides Settings with, as the list and the import preview both hold them. */
export interface ProfileColumns {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  toolDiscovery: string;
  toolSelectModel: string;
  requestTimeoutSeconds: number;
  maxRetries: number;
}

/**
 * What a profile changes, one phrase per column that is not at its inherit sentinel.
 *
 * A profile is mostly inherit, so listing what it *is* would be listing the settings page. Here
 * rather than in the route because the import preview says the same thing about a profile that
 * does not exist yet, and two copies of the sentinels would be two readings of them.
 */
export function overrides(agent: ProfileColumns): string[] {
  const said: string[] = [];
  if (agent.baseUrl) said.push(agent.baseUrl);
  if (agent.model) said.push(agent.model);
  if (agent.systemPrompt) said.push("system prompt");
  if (agent.maxTokens >= 0) said.push(`${agent.maxTokens} tokens`);
  if (agent.temperature >= 0) said.push(`temp ${agent.temperature}`);
  if (agent.maxToolIterations >= 0) said.push(`${agent.maxToolIterations} tool steps`);
  if (agent.toolDiscovery !== "inherit") said.push(agent.toolDiscovery);
  if (agent.toolSelectModel) said.push(`picks tools with ${agent.toolSelectModel}`);
  if (agent.requestTimeoutSeconds >= 0) said.push(`${agent.requestTimeoutSeconds}s of silence`);
  if (agent.maxRetries >= 0) said.push(`${agent.maxRetries} retries`);
  return said;
}

/** What a box of pasted text turned out to be: a document to ask the server about, or why not. */
export type SpecRead = { document: unknown; problem?: undefined } | { problem: string };

/**
 * Reads pasted or picked text as far as the browser can: is it JSON at all.
 *
 * Whether the JSON is an agent spec is the server's to say, in the parser's own words, and it
 * says so in the preview. The one thing kept back is a bare `null`, which the API's `JSON!`
 * would turn away as a missing argument rather than as a document that is not a spec.
 */
export function readSpec(text: string): SpecRead {
  if (!text.trim()) return { problem: "Paste an agent spec, or choose a file." };
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    return { problem: `This is not JSON: ${(error as Error).message}` };
  }
  if (document === null) return { problem: "This is not an agent spec: it is null." };
  return { document };
}

/**
 * Which bundled servers start ticked: the ones the server says a form should offer that way.
 *
 * In the document's order, one answer per server, because that is how the form holds them — a
 * slug is whatever somebody wrote in a file, and a form path made of one would break on a dot.
 */
export const initialTicks = (bundled: readonly { createByDefault: boolean }[]): boolean[] =>
  bundled.map((server) => server.createByDefault);

/** The ticks as the API wants them: the slugs to create, in the document's order. */
export const tickedSlugs = (
  bundled: readonly { slug: string }[],
  ticks: readonly (boolean | undefined)[],
): string[] => bundled.filter((_, index) => ticks[index] === true).map((server) => server.slug);

/**
 * Whether Import may be pressed.
 *
 * The preview on screen has to be the answer to what is in the form now — a tick changed since
 * it was asked for is a server that would be created without having been shown as one.
 */
export const mayImport = (
  preview: { refusals: readonly string[] } | undefined,
  settled: boolean,
): boolean => Boolean(preview) && settled && preview?.refusals.length === 0;

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
