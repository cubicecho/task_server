/**
 * How a prompt names an MCP resource to be read on every run: `{{resource:<slug>:<uri>}}`.
 *
 * In the one place both halves read it, for `shared/flow.ts`'s reason: the picker writes the
 * placeholder and the runner reads it, and two spellings of one grammar are a placeholder the
 * editor inserts happily and the run never finds.
 *
 * The server's slug is part of it because a uri's scheme is the server's own — `ragdown://` says
 * what kind of thing it is, not which configured row serves it, and two rows may serve the same
 * scheme. A slug cannot hold a `:`, so the first one after the slug ends it and the uri keeps
 * every `:` of its own. A uri cannot hold `}}`; an expanded template percent-encodes braces.
 *
 * Nothing in here may import anything, for the same reason as `shared/flow.ts`.
 */

/** One placeholder anywhere in a prompt. Global: callers iterate with `matchAll`. */
export const RESOURCE_PLACEHOLDER = /\{\{\s*resource:([^:}\s]+):(.+?)\s*\}\}/gi;

/** A resource a prompt names. */
export interface ResourceRef {
  /** The MCP server row's slug, as written. */
  server: string;
  uri: string;
}

/**
 * One read a step made, as `run_steps.resources` keeps it: what the prompt the model saw
 * depended on, and when it was read, since the server's copy may have changed since.
 */
export interface ResourceRead extends ResourceRef {
  /** When the read finished, or failed, ISO 8601. */
  readAt: string;
  /** How many characters went into the prompt — after the cap, when it cut. */
  chars: number;
  /** Whether the cap cut it. */
  truncated: boolean;
  /** The contents' type, where the server gave one. */
  mimeType?: string;
  /** Why it could not be read. The step failed with it. */
  error?: string;
}

/** The placeholder for a resource, as the picker inserts it. */
export const resourcePlaceholder = ({ server, uri }: ResourceRef) =>
  `{{resource:${server}:${uri}}}`;

/** The key one resource is read under, so a uri named twice in one prompt is read once. */
export const resourceKey = ({ server, uri }: ResourceRef) => `${server}:${uri}`;

/** Every distinct resource a prompt names, in the order it first names them. */
export function resourceRefs(prompt: string): ResourceRef[] {
  const found = new Map<string, ResourceRef>();
  for (const [, server, uri] of prompt.matchAll(RESOURCE_PLACEHOLDER)) {
    const ref = { server, uri };
    found.set(resourceKey(ref), found.get(resourceKey(ref)) ?? ref);
  }
  return [...found.values()];
}
