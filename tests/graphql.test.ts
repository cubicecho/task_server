import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type GraphQLSchema, graphql } from "graphql";
import { afterAll, beforeAll, expect, test } from "vitest";

// The schema is built from the live Drizzle tables at import time, so the database has to be
// pointed somewhere disposable before anything under server/ is loaded.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-test-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let schema: GraphQLSchema;
let cron: typeof import("../server/scheduler/cron.ts");

beforeAll(async () => {
  const { ensureSchema } = await import("../server/db/migrate.ts");
  await ensureSchema();
  schema = (await import("../server/graphql/schema.ts")).schema;
  cron = await import("../server/scheduler/cron.ts");
});

afterAll(async () => {
  await cron.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function run(source: string, variableValues?: Record<string, unknown>) {
  const result = await graphql({ schema, source, variableValues });
  expect(result.errors).toBeUndefined();
  // biome-ignore lint/suspicious/noExplicitAny: assertions walk arbitrary GraphQL payloads.
  return result.data as Record<string, any>;
}

test("a task with a cron trigger lands on the schedule", async () => {
  const { createTask: task } = await run(
    `mutation { createTask(values: { name: "digest", prompt: "summarise" }) { id name } }`,
  );
  expect(task.name).toBe("digest");

  const { createTrigger: trigger } = await run(
    `mutation Create($taskId: String!) {
       createTrigger(values: { taskId: $taskId, cron: "0 9 * * *", timezone: "America/Chicago" }) {
         id kind
       }
     }`,
    { taskId: task.id },
  );
  expect(trigger.kind).toBe("cron");

  // No `cron.sync()` here on purpose. The rebuild is debounced past the mutation's own
  // transaction, and reading `schedule` is what pays it off — the assertion below is the whole
  // point of that: an agent calls these two back to back and must not be shown the old answer.
  const { schedule } = await run(`{ schedule { triggerId taskId cron nextRun } }`);
  expect(schedule).toHaveLength(1);
  expect(schedule[0]).toMatchObject({ triggerId: trigger.id, taskId: task.id, cron: "0 9 * * *" });
  expect(Date.parse(schedule[0].nextRun)).toBeGreaterThan(Date.now());
});

test("disabling the task takes its triggers off the schedule with it", async () => {
  const { tasks } = await run(`{ tasks { id } }`);
  // The single-row form, which is the only one there is: `permissions.ts` shuts every bulk
  // write, and `updateTask` with no `where` rewrites the table.
  await run(
    `mutation Off($id: String!) { updateTaskSingle(set: { enabled: false }, where: { id: { eq: $id } }) { id } }`,
    {
      id: tasks[0].id,
    },
  );

  const { schedule } = await run(`{ schedule { triggerId } }`);
  expect(schedule).toEqual([]);
});

test("a cron trigger with no expression is refused, whether or not the kind is spelled out", async () => {
  const { createTask: task } = await run(
    `mutation { createTask(values: { name: "unarmed", prompt: "nothing" }) { id } }`,
  );

  // Both of these used to be stored: `enabled: true`, and fired by neither a clock nor a
  // webhook. The second is the one that costs something — `kind` defaults to `cron`, so writing
  // only an `event` id produces a cron trigger whose expression is empty, and `POST
  // /webhooks/<id>` dispatches on `kind: "event"` and will never reach it either.
  for (const values of ["kind: cron", 'event: "deploy"']) {
    const rejected = await graphql({
      schema,
      source: `mutation Create($taskId: String!) {
         createTrigger(values: { taskId: $taskId, ${values} }) { id }
       }`,
      variableValues: { taskId: task.id },
    });
    expect(rejected.errors?.[0].message).toMatch(/needs an expression/);
  }

  const { triggers } = await run(
    `query T($id: String!) { triggers(where: { taskId: { eq: $id } }) { id } }`,
    { id: task.id },
  );
  expect(triggers).toEqual([]);

  // An update that names no kind still says nothing about the row it lands on, so it is left
  // alone: an event trigger's `cron` column is legitimately empty.
  const { createTrigger: event } = await run(
    `mutation Create($taskId: String!) {
       createTrigger(values: { taskId: $taskId, kind: event, event: "deploy" }) { id }
     }`,
    { taskId: task.id },
  );
  const { updateTriggerSingle: renamed } = await run(
    `mutation Rename($id: String!) {
       updateTriggerSingle(set: { event: "released" }, where: { id: { eq: $id } }) { id event }
     }`,
    { id: event.id },
  );
  expect(renamed.event).toBe("released");
});

test("a broken MCP config is reported, not thrown", async () => {
  const { testMcpServer } = await run(
    `mutation { testMcpServer(config: { transport: "stdio", command: "" }) { ok error tools { name } } }`,
  );
  // A test that cannot connect is a normal answer for this mutation — the point of the button
  // is to find out, so the reason belongs in the payload rather than in an errors array.
  expect(testMcpServer).toMatchObject({ ok: false, tools: [] });
  expect(testMcpServer.error).toMatch(/command/);

  const { testMcpServer: missing } = await run(
    `mutation { testMcpServer(config: { transport: "stdio", command: "definitely-not-a-real-binary" }) { ok error } }`,
  );
  expect(missing.ok).toBe(false);
  expect(missing.error).not.toBe("");
});

const FLOW = `
  mutation Set($taskId: String!, $steps: [StepInput!]!) {
    setTaskSteps(taskId: $taskId, steps: $steps) {
      id parentId branch position kind name prompt cases context enabled
    }
  }`;

test("a flow is written as a tree and comes back as the rows that run it", async () => {
  const { createTask: task } = await run(
    `mutation { createTask(values: { name: "mail", prompt: "read the last five emails" }) { id } }`,
  );

  const { setTaskSteps: rows } = await run(FLOW, {
    taskId: task.id,
    steps: [
      {
        kind: "decision",
        name: "any errors?",
        prompt: "do any of these report an application error?",
        cases: ["error", "clean"],
        branches: [
          { case: "error", steps: [{ name: "write it up", prompt: "write an md file" }] },
          { case: "clean", steps: [{ name: "print", prompt: "print the subject lines" }] },
        ],
      },
      { name: "done", prompt: "say so", context: "previous" },
    ],
  });

  // Flattened depth-first, so a parent is always written before the children that name it.
  expect(rows.map((row: { name: string }) => row.name)).toEqual([
    "any errors?",
    "write it up",
    "print",
    "done",
  ]);
  const [decision, wrote, printed, done] = rows;
  expect(decision).toMatchObject({ parentId: null, branch: "", position: 0, kind: "decision" });
  expect(decision.cases).toEqual(["error", "clean"]);
  expect(wrote).toMatchObject({ parentId: decision.id, branch: "error", position: 0 });
  expect(printed).toMatchObject({ parentId: decision.id, branch: "clean", position: 0 });
  // A sibling of the decision, not a child of it — the arms do not consume the sequence.
  expect(done).toMatchObject({ parentId: null, branch: "", position: 1, context: "previous" });

  // Sent back with their ids, the surviving steps are edited in place rather than replaced, so
  // the run history that points at them stays pointed at them.
  const { setTaskSteps: edited } = await run(FLOW, {
    taskId: task.id,
    steps: [
      {
        id: decision.id,
        kind: "decision",
        name: "any errors?",
        prompt: "look again",
        cases: ["error", "clean"],
        branches: [{ case: "error", steps: [{ id: wrote.id, name: "write it up", prompt: "md" }] }],
      },
    ],
  });
  expect(edited.map((row: { id: string }) => row.id)).toEqual([decision.id, wrote.id]);
  expect(edited[0].prompt).toBe("look again");
  // The arm that went away took its step with it.
  const { steps } = await run(
    `query S($id: String!) { steps(where: { taskId: { eq: $id } }) { id } }`,
    {
      id: task.id,
    },
  );
  expect(steps.map((row: { id: string }) => row.id).sort()).toEqual([decision.id, wrote.id].sort());

  // And an empty list leaves the task with nothing but its own prompt.
  const { setTaskSteps: cleared } = await run(FLOW, { taskId: task.id, steps: [] });
  expect(cleared).toEqual([]);
});

test("rewriting a flow counts as editing the task", async () => {
  // Nothing on the task row changes when its steps do, so `updatedAt` would sit still through a
  // rewrite of the whole flow — and it is what "newest edit first" orders by, which would leave
  // an agent's own last edit missing from the top of the listing it goes looking in.
  const { createTask: task } = await run(
    `mutation { createTask(values: { name: "touched", prompt: "go" }) { id updatedAt } }`,
  );

  await run(FLOW, {
    taskId: task.id,
    steps: [{ name: "one", prompt: "do it" }],
  });

  const { tasks: after } = await run(
    `query Read($id: String!) { tasks(where: { id: { eq: $id } }) { updatedAt } }`,
    { id: task.id },
  );
  expect(new Date(after[0].updatedAt).getTime()).toBeGreaterThan(
    new Date(task.updatedAt).getTime(),
  );
});

test("a flow that cannot run is refused before any of it is written", async () => {
  const { createTask: task } = await run(
    `mutation { createTask(values: { name: "bad", prompt: "go" }) { id } }`,
  );

  const cases = [
    {
      why: /not one of its cases/,
      steps: [
        {
          kind: "decision",
          name: "pick",
          prompt: "which?",
          cases: ["error"],
          branches: [{ case: "clean", steps: [{ prompt: "never" }] }],
        },
      ],
    },
    {
      why: /no cases to choose between/,
      steps: [{ kind: "decision", name: "pick", prompt: "which?" }],
    },
    {
      why: /not a decision/,
      steps: [
        { name: "plain", prompt: "go", branches: [{ case: "error", steps: [{ prompt: "no" }] }] },
      ],
    },
    { why: /has no prompt/, steps: [{ name: "empty", prompt: "  " }] },
    { why: /Unknown step kind/, steps: [{ kind: "sideways", prompt: "go" }] },
  ];

  for (const { why, steps } of cases) {
    const result = await graphql({
      schema,
      source: FLOW,
      variableValues: { taskId: task.id, steps },
    });
    expect(result.errors?.[0].message).toMatch(why);
  }

  // Every one of them was refused before anything was written, so the task still has no flow.
  const { steps } = await run(
    `query S($id: String!) { steps(where: { taskId: { eq: $id } }) { id } }`,
    {
      id: task.id,
    },
  );
  expect(steps).toEqual([]);
});

test("the api key is write-only", async () => {
  const result = await graphql({ schema, source: `{ settings { apiKey } }` });
  expect(result.errors?.[0].message).toMatch(/apiKey/);

  const { setApiKey } = await run(`mutation { setApiKey(apiKey: "sk-test") }`);
  expect(setApiKey).toBe(true);
});

test("an expression the scheduler cannot read is refused, not stored", async () => {
  const { createTask: task } = await run(
    `mutation { createTask(values: { name: "hourly", prompt: "check" }) { id } }`,
  );

  const rejected = await graphql({
    schema,
    source: `mutation Create($taskId: String!) {
       createTrigger(values: { taskId: $taskId, cron: "every tuesday" }) { id }
     }`,
    variableValues: { taskId: task.id },
  });
  expect(rejected.errors?.[0].message).toMatch(/not a cron expression/);

  // Refused before the insert, rather than accepted and skipped at the next sync — which is
  // what it would look like from here either way if the check ran in the scheduler.
  const { triggers } = await run(
    `query T($id: String!) { triggers(where: { taskId: { eq: $id } }) { id } }`,
    { id: task.id },
  );
  expect(triggers).toEqual([]);

  // An event trigger has no schedule, and its empty expression is not a broken one.
  const { createTrigger: event } = await run(
    `mutation Create($taskId: String!) {
       createTrigger(values: { taskId: $taskId, kind: event, event: "deploy" }) { id kind }
     }`,
    { taskId: task.id },
  );
  expect(event.kind).toBe("event");
});

test("an event trigger with no webhook id is refused", async () => {
  const { createTask: task } = await run(
    `mutation { createTask(values: { name: "on push", prompt: "build" }) { id } }`,
  );

  // `POST /webhooks/<id>` matches on the id, so a trigger without one is an address that
  // cannot be written down — a row that looks armed and nothing can ever reach.
  const rejected = await graphql({
    schema,
    source: `mutation Create($taskId: String!) {
       createTrigger(values: { taskId: $taskId, kind: event }) { id }
     }`,
    variableValues: { taskId: task.id },
  });
  expect(rejected.errors?.[0].message).toMatch(/needs a webhook id/);

  const { triggers } = await run(
    `query T($id: String!) { triggers(where: { taskId: { eq: $id } }) { id } }`,
    { id: task.id },
  );
  expect(triggers).toEqual([]);
});

test("a trigger's addresses are stored in the shape they are matched in", async () => {
  const { createTask: task } = await run(
    `mutation { createTask(values: { name: "padded", prompt: "p" }) { id } }`,
  );

  // Whitespace is what a pasted id arrives with, and it used to survive a guard that only
  // checked for emptiness — leaving a row reading `enabled: true` at an address nobody can type.
  const { createTrigger: event } = await run(
    `mutation { createTrigger(values: { taskId: "${task.id}", kind: event, event: "  deploy " })
       { id event } }`,
  );
  expect(event.event).toBe("deploy");

  const { createTrigger: cron } = await run(
    `mutation { createTrigger(values: { taskId: "${task.id}", kind: cron, cron: " 0 9 * * * " })
       { cron } }`,
  );
  expect(cron.cron).toBe("0 9 * * *");

  // An update goes through the same sweep as a create.
  const { updateTriggerSingle: edited } = await run(
    `mutation { updateTriggerSingle(where: { id: { eq: "${event.id}" } }, set: { event: " later " })
       { event } }`,
  );
  expect(edited.event).toBe("later");
});
