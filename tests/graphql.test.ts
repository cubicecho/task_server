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

  // The onWrite hook debounces its scheduler rebuild past the mutation's own transaction.
  await cron.sync();

  const { schedule } = await run(`{ schedule { triggerId taskId cron nextRun } }`);
  expect(schedule).toHaveLength(1);
  expect(schedule[0]).toMatchObject({ triggerId: trigger.id, taskId: task.id, cron: "0 9 * * *" });
  expect(Date.parse(schedule[0].nextRun)).toBeGreaterThan(Date.now());
});

test("disabling the task takes its triggers off the schedule with it", async () => {
  const { tasks } = await run(`{ tasks { id } }`);
  await run(
    `mutation Off($id: String!) { updateTask(set: { enabled: false }, where: { id: { eq: $id } }) { id } }`,
    {
      id: tasks[0].id,
    },
  );

  await cron.sync();
  const { schedule } = await run(`{ schedule { triggerId } }`);
  expect(schedule).toEqual([]);
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
