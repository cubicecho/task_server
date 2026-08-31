import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { print } from "graphql";

/** The browser build talks to its own origin; Vite proxies `/graphql` to the server in dev. */
const ENDPOINT = "/graphql";

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * One request, typed by the document.
 *
 * `TypedDocumentNode` carries both the result and the variables types, so the call site needs
 * no annotations and a document that changes shape breaks compilation rather than at runtime.
 */
export async function request<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  ...[variables]: TVariables extends Record<string, never> ? [] : [TVariables]
): Promise<TResult> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: print(document), variables }),
  });

  const body = (await response.json()) as GraphQLResponse<TResult>;
  // GraphQL reports failures in the body with a 200, so the status alone proves nothing.
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  if (!body.data) throw new Error(`GraphQL returned no data (HTTP ${response.status})`);
  return body.data;
}
