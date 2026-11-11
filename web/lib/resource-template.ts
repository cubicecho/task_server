import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";

/**
 * A resource template's variables, and the uri once they are filled in — by the SDK's own RFC
 * 6570 reading, which is the one a server built on it matches the uri back against. A template
 * written by hand would expand `{+path}` and `{path}` the same way, and one of them would then
 * be a uri the server does not recognise as its own.
 */

/** The template's variables in the order it names them, or null for one that is not a template. */
export function templateVariables(uriTemplate: string): string[] | null {
  try {
    return new UriTemplate(uriTemplate).variableNames;
  } catch {
    return null;
  }
}

/** The uri the template names with `values` in it. */
export const expandTemplate = (uriTemplate: string, values: Record<string, string>) =>
  new UriTemplate(uriTemplate).expand(values);
