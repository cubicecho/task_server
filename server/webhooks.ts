import { and, eq } from "drizzle-orm";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { errorMessage } from "../shared/errors.ts";
import { db } from "./db/client.ts";
import { tasks, triggers } from "./db/schema.ts";
import { fireTask } from "./runner/run.ts";

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
  app.post("/webhooks/:id", readBody, (req: Request, res: Response) => {
    // Express 5 types a wildcard param as `string | string[]`; this one is a single segment.
    const event = String(req.params.id);
    // `req.body` is `any`, and everything downstream of here wants it to be `unknown`: the
    // server never looks inside it, it only stores it and prints it into a prompt.
    const payload: unknown = req.body ?? null;
    void dispatch(event, payload)
      .then((outcome) => res.json({ ok: true, event, ...outcome }))
      .catch((error: unknown) => {
        // Reaching here means the lookup itself failed — the database, not any one task. The
        // sender has delivered the event and has nothing useful to do with that, so it is
        // reported here and acknowledged there.
        console.error(`[webhook] ${event}:`, error);
        res.json({ ok: true, event, dispatched: [], queued: [], refused: [] });
      });
  });
}

const parseJson = express.json({ limit: "1mb" });

/**
 * The body, when there is one that can be read, and nothing when there is not.
 *
 * Scoped to this route rather than the app: yoga and the MCP handler read their own bodies, and
 * a parser in front of them would take the stream they are waiting for.
 *
 * `express.json` hands a body it cannot parse — malformed JSON, or more than the limit — to
 * Express's error handler, which is a 500 in this app and a 400 in a bare router. Either would
 * tell a sender its delivery failed when the id arrived perfectly well, and this route answers
 * 200 to everything. So the failure is logged and the request goes on with no payload, which is
 * what `{{event}}` renders as. A body is an argument to the event, never a condition of it.
 */
function readBody(req: Request, res: Response, next: NextFunction) {
  parseJson(req, res, (error?: unknown) => {
    if (error) {
      console.error(`[webhook] ${String(req.params.id)}: unreadable body: ${errorMessage(error)}`);
    }
    next();
  });
}

type Dispatched = { taskId: string; name: string; runId: string };
type Refused = { taskId: string; name: string; runId: string; reason: string };
/** Accepted, waiting for a slot. The same shape as a refusal, because it is not one. */
type Queued = Refused;

/**
 * Starts every enabled task with an enabled `event` trigger for this id, and answers with what
 * it started and what it would not.
 *
 * The runs are started and not waited on. A sender wants an acknowledgement, not the output of
 * an agent that may still be working several minutes from now — so a firing is awaited only as
 * far as the run row, and the run itself is watchable over `runEvents` and lands in the run
 * history either way.
 *
 * A task already running is the refusal worth expecting, and it goes in the reply rather than
 * only to the log. Anything that fires faster than it runs meets it routinely, and a sender
 * cannot tell a skipped delivery from a successful one by any other means: `dispatched` used to
 * name the task regardless. Reporting nothing at all would be no better — `dispatched: []` with
 * no reason says only that something did not happen.
 *
 * `fireTask` records the skip as a run of its own, so every arm carries a `runId`: what the
 * sender is told and what the Runs page shows are the same delivery, and a sender that kept the
 * id can go and look at it.
 *
 * `queued` is neither of the other two and gets its own list. The delivery was accepted and the
 * task will run — it is waiting for a slot, not turned away — and a sender told `refused` would
 * reasonably send again, which is the opposite of what the queue is for. The run id is the row
 * it is waiting in, and is the id it keeps once it runs.
 *
 * Started one at a time, not in parallel: two triggers on one task are two attempts at the same
 * `inFlight` entry, and sequencing them means the second is refused rather than racing.
 *
 * The payload goes to every task listening for the id, and is kept on the run whether or not a
 * run started — a skip that threw the body away would leave nothing to say what was missed.
 */
async function dispatch(
  event: string,
  payload: unknown,
): Promise<{ dispatched: Dispatched[]; queued: Queued[]; refused: Refused[] }> {
  if (!event) return { dispatched: [], queued: [], refused: [] };

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
    return { dispatched: [], queued: [], refused: [] };
  }

  const dispatched: Dispatched[] = [];
  const queued: Queued[] = [];
  const refused: Refused[] = [];

  for (const { triggerId, taskId, name } of rows) {
    try {
      const fired = await fireTask(taskId, triggerId, payload);
      if (!fired.started) {
        console.log(`[webhook] ${event}: ${name}: ${fired.reason}`);
        const entry = { taskId, name, runId: fired.run.id, reason: fired.reason };
        (fired.queued ? queued : refused).push(entry);
        continue;
      }
      // The run is under way and the reply does not wait for it. Whatever it comes to is on the
      // run row; this only catches a `done` that could not be written at all.
      fired.done.catch((error: unknown) => {
        console.error(`[webhook] ${event}: ${name}: ${errorMessage(error)}`);
      });
      dispatched.push({ taskId, name, runId: fired.run.id });
    } catch (error) {
      // Not a refusal — the task is gone, or its run row could not be written. Nothing was
      // recorded, so the log is the only account of it.
      console.error(`[webhook] ${event}: ${name}: ${errorMessage(error)}`);
    }
  }

  return { dispatched, queued, refused };
}
