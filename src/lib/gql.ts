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

export interface SubscriptionHandlers<TResult> {
  next: (data: TResult) => void;
  error?: (error: Error) => void;
  complete?: () => void;
}

/**
 * One subscription, over server-sent events.
 *
 * Yoga answers a subscription sent as `GET /graphql?query=…` with an SSE stream — one `next`
 * event per payload, then `complete` — which is exactly what the browser's own `EventSource`
 * reads, so this needs no client library. It also reconnects on its own if the connection
 * drops, and the server replays the run from the start, so a reconnect costs a repeat rather
 * than a hole. Payloads carry a sequence number for the caller to de-duplicate on.
 *
 * Returns the unsubscribe: call it on unmount, or the stream outlives the component.
 */
export function subscribe<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
  handlers: SubscriptionHandlers<TResult>,
): () => void {
  const params = new URLSearchParams({
    query: print(document),
    variables: JSON.stringify(variables ?? {}),
  });
  const source = new EventSource(`${ENDPOINT}?${params}`);

  source.addEventListener("next", (message) => {
    const body = JSON.parse(message.data) as GraphQLResponse<TResult>;
    if (body.errors?.length) {
      handlers.error?.(new Error(body.errors.map((error) => error.message).join("; ")));
      return;
    }
    if (body.data) handlers.next(body.data);
  });

  source.addEventListener("complete", () => {
    source.close();
    handlers.complete?.();
  });

  // `EventSource` reports every failure as one opaque event and retries by itself, so this
  // says the connection dropped and leaves it to reconnect rather than tearing the stream down.
  source.onerror = () => handlers.error?.(new Error("lost the connection to the server"));

  return () => source.close();
}
