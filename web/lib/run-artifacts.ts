/**
 * Which ways out a run's artifact row offers: open it, preview it, copy its uri.
 *
 * Here rather than in the route because each answer is a claim about a uri a server wrote, and
 * getting one wrong is either a dead button or a link to somewhere the server never meant.
 */

/** The fields of a `run_artifacts` row the decision reads. */
export interface ArtifactLink {
  uri: string;
  webUrl: string;
  serverId?: string | null | undefined;
  title: string;
  name: string;
}

export interface ArtifactActions {
  /** Where Open goes, in a new tab. Null for no Open. */
  open: string | null;
  /** Whether the row has a Preview, which reads the resource back from its server. */
  preview: boolean;
  /** Why Preview cannot be pressed, where it is offered and cannot be. */
  previewRefused: string | undefined;
  /** What Copy puts on the clipboard: always the uri, which is what the server can resolve. */
  copy: string;
}

/**
 * Whether a string is a web address a browser may be sent to.
 *
 * Parsed rather than matched on a prefix, and held to `http:` and `https:` alone: a `webUrl` is
 * whatever a server put under its `_meta`, and a `javascript:` there would otherwise be a link.
 */
export function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The row's buttons.
 *
 * Open goes to `webUrl` where the server gave one, else to the `uri` when that is itself `http(s)`
 * — which the spec reserves for a resource a client can fetch directly. Any other uri
 * (`ragdown://`, `file://`) names something only its server can read, so it gets Preview; a doc
 * with both a private uri and a `webUrl` gets both. A Preview whose server has since been removed
 * is still drawn, refused, so the row says why it cannot be read rather than looking like one
 * that never could.
 */
export function artifactActions(link: ArtifactLink): ArtifactActions {
  const direct = isWebAddress(link.uri);
  const open = isWebAddress(link.webUrl) ? link.webUrl : direct ? link.uri : null;
  const preview = !direct;
  return {
    open,
    preview,
    previewRefused:
      preview && !link.serverId
        ? "Its MCP server has been removed, so there is nothing to read it back from"
        : undefined,
    copy: link.uri,
  };
}

/** What the row is called: the link's title, else its name, else the uri itself. */
export const artifactLabel = (link: Pick<ArtifactLink, "title" | "name" | "uri">) =>
  link.title || link.name || link.uri;

/**
 * Whether a preview is drawn as Markdown rather than as text in a code block.
 *
 * The read's own type wins, since it describes what came back now; the row's, from the link, is
 * the fallback for a server that types its links and not its reads.
 */
export function isMarkdown(readType: string, linkType: string): boolean {
  const type = (readType || linkType).split(";")[0].trim().toLowerCase();
  return type === "text/markdown" || type === "text/x-markdown";
}
