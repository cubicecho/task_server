import { history, RunEventKind } from "@cubicecho/agent-core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { completion, notChat, replyWith, toolCall } from "./fixtures/sse.ts";
import { dataDir, type FakeModel, fakeModel, useModel } from "./helpers.ts";

dataDir("slot-pinning");

/** What each chat request carried that says which run it belongs to. */
const seen: { session?: string; slot?: unknown }[] = [];
let model: FakeModel;

beforeAll(async () => {
  // A llama.cpp server as far as a run can tell: `/props` reports two slots.
  model = await fakeModel(
    (body, response) => {
      seen[seen.length - 1].slot = (body as { id_slot?: unknown }).id_slot;
      replyWith(response, seen.length === 1 ? toolCall("missing__tool") : completion("done"), body);
    },
    (request, response) => {
      if (request.url?.startsWith("/props")) {
        request.resume();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ total_slots: 2 }));
        return true;
      }
      if (notChat(request, response)) {
        return true;
      }
      seen.push({ session: String(request.headers["x-session-id"] ?? "") });
      return false;
    },
  );

  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  await useModel(model);
});

afterAll(async () => {
  await model.close();
});

test("every request of a run is pinned to one slot under the run's id, and the stream says so", async () => {
  const { db } = await import("../server/db/client.ts");
  const { tasks } = await import("../server/db/schema.ts");
  const { startTask } = await import("../server/runner/run.ts");
  const [task] = await db.insert(tasks).values({ name: "pinned", prompt: "go" }).returning();

  const { run, done } = await startTask(task.id);
  expect((await done).status).toBe("ok");

  // Two requests — the tool call and the answer — and both name the run and the same slot.
  expect(seen).toHaveLength(2);
  expect(seen.map((request) => request.session)).toEqual([run.id, run.id]);
  expect(typeof seen[0].slot).toBe("number");
  expect(seen[1].slot).toBe(seen[0].slot);

  const notices = history(run.id)
    .filter((event) => event.kind === RunEventKind.Notice)
    .map((event) => event.text);
  expect(notices).toContain(`pinned to slot ${seen[0].slot} of 2`);
});
