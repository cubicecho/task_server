import { and, eq } from "drizzle-orm";
import express, { type Express, type Request, type Response } from "express";
import { db } from "./db/client.ts";
import { tasks, triggers } from "./db/schema.ts";
import { runTask } from "./runner/run.ts";

/**
 * `POST /webhooks/<id>` — the inbound half of an `event` trigger.
 *
 * The route is deliberately unconditional: every id is a valid address and every call is
 * answered, whether or not anything is listening for it. That is what makes a webhook usable
 * before the trigger exists — point the sender at an id, watch the calls arrive, then create
 * the trigger that acts on them — and it stops this endpoint from being a directory of which
 * ids are real, which a 404 on the unknown ones would make it.
 *
 * The id is the whole of the address and the whole of the authentication. See `AGENTS.md`.
 */
export function mountWebhooks(app: Express) {
  // Scoped to this route rather than the app: yoga and the MCP handler read their own bodies,
  // and a parser in front of them would take the stream they are waiting for. Parsed and then
  // ignored — the id is the whole of the message today — but a sender that posts JSON should
  // get an answer rather than a hang, and the body is where an event's payload will go.
  app.post("/webhooks/:id", express.json({ limit: "1mb" }), (req: Request, res: Response) => {
    // Express 5 types a wildcard param as `string | string[]`; this one is a single segment.
    const event = String(req.params.id);
    void dispatch(event)
      .then((dispatched) => res.json({ ok: true, event, dispatched }))
      .catch((error: unknown) => {
        // A task that would not start is this server's problem, not the sender's: it has
        // delivered the event and has nothing useful to do with the failure. It is reported
        // here and acknowledged there.
        console.error(`[webhook] ${event}:`, error);
        res.json({ ok: true, event, dispatched: [] });
      });
  });
}

/**
 * Starts every enabled task with an enabled `event` trigger for this id, and answers with what
 * it started.
 *
 * The runs are started and not waited on. A sender wants an acknowledgement, not the output of
 * an agent that may still be working several minutes from now — so the reply says which tasks
 * were dispatched, and the run itself is watchable over `runEvents` and lands in the run
 * history either way. A task already running is the one refusal worth expecting; `runTask`
 * rejects and the rejection is logged rather than delivered.
 */
async function dispatch(event: string): Promise<{ taskId: string; name: string }[]> {
  if (!event) return [];

  const rows = await db
    .select({ triggerId: triggers.id, taskId: triggers.taskId, name: tasks.name })
    .from(triggers)
    .innerJoin(tasks, eq(triggers.taskId, tasks.id))
    .where(
      and(
        eq(triggers.kind, "event"),
        eq(triggers.event, event),
        eq(triggers.enabled, true),
        eq(tasks.enabled, true),
      ),
    );

  if (!rows.length) {
    console.log(`[webhook] ${event}: nothing is listening`);
    return [];
  }

  for (const row of rows) {
    void runTask(row.taskId, row.triggerId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[webhook] ${event}: ${row.name}: ${message}`);
    });
  }
  return rows.map(({ taskId, name }) => ({ taskId, name }));
}
