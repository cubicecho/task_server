import http from "node:http";
import type { AddressInfo } from "node:net";
import { type ChatBody, notChat } from "./fixtures/sse.ts";

/**
 * What the suites that need a model, or a database pointed at one, would otherwise each write
 * out. Nothing under `server/` is imported at the top: a suite sets `TASK_SERVER_DATA_DIR`
 * before it loads any of that, and a static import here would load it first.
 */

export interface FakeModel {
  /** What `settings.baseUrl` is set to. */
  baseUrl: string;
  close(): Promise<void>;
}

type Route = (request: http.IncomingMessage, response: http.ServerResponse) => boolean;

async function listen(server: http.Server): Promise<FakeModel> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => {
      // A stopped run's request is aborted, but the question it asked of `/models` first is
      // not the run's to cancel, and a server that never answers would wait on it.
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * A model server on a local port that hands each chat request to `answer`.
 *
 * `elsewhere` gets every request first and says whether it answered it; by default that is
 * `notChat`, a 404 for everything that is not a chat request.
 */
export const fakeModel = (
  answer: (body: ChatBody, response: http.ServerResponse) => void,
  elsewhere: Route = notChat,
): Promise<FakeModel> =>
  listen(
    http.createServer((request, response) => {
      if (elsewhere(request, response)) return;
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => answer(JSON.parse(body), response));
    }),
  );

/** A model server that accepts the request and never answers, so a run stays in flight. */
export const hangingModel = (): Promise<FakeModel> => listen(http.createServer(() => {}));

/** Points the settings row at a fake model, which is what every run then talks to. */
export async function useModel(model: FakeModel) {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../server/db/client.ts");
  const { settings } = await import("../server/db/schema.ts");
  await db
    .update(settings)
    .set({ baseUrl: model.baseUrl, model: "fake" })
    .where(eq(settings.id, "default"));
}
