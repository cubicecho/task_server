import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Step } from "../server/db/schema.ts";

// The flow module imports the database client to write its run steps, so point the database
// somewhere disposable before anything under server/ is loaded. Nothing here touches it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-server-flow-"));
process.env.TASK_SERVER_DATA_DIR = dir;

let flow: typeof import("../server/runner/flow.ts");

beforeAll(async () => {
  flow = await import("../server/runner/flow.ts");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

let clock = 0;
const step = (row: Partial<Step> & { id: string }): Step =>
  ({
    taskId: "t1",
    parentId: null,
    branch: "",
    position: 0,
    kind: "agent",
    name: "",
    prompt: "",
    cases: null,
    model: "",
    systemPrompt: "",
    context: "all",
    enabled: true,
    // Distinct by construction, so the tie-break on equal positions is deterministic.
    createdAt: new Date(++clock),
    ...row,
  }) as Step;

const names = (nodes: { step: Step }[]) => nodes.map((node) => node.step.name);

test("the tree comes back in position order, nested by the arm each step sits in", () => {
  const rows = [
    step({ id: "b", name: "second", position: 1 }),
    step({ id: "a", name: "ask", position: 0, kind: "decision", cases: ["yes", "no"] }),
    step({ id: "a2", name: "no path", parentId: "a", branch: "no", position: 0 }),
    step({ id: "a1", name: "yes path", parentId: "a", branch: "yes", position: 0 }),
    step({ id: "a1b", name: "and then", parentId: "a", branch: "yes", position: 1 }),
  ];

  const tree = flow.buildTree(rows);
  expect(names(tree)).toEqual(["ask", "second"]);
  expect(names(tree[0].branches.get("yes") ?? [])).toEqual(["yes path", "and then"]);
  expect(names(tree[0].branches.get("no") ?? [])).toEqual(["no path"]);
  // A step of one arm is not reachable from another.
  expect(tree[0].branches.get("maybe")).toBeUndefined();
});

test("steps sharing a position keep a stable order rather than an accidental one", () => {
  const first = step({ id: "z", name: "first", position: 0 });
  const second = step({ id: "a", name: "second", position: 0 });
  expect(names(flow.buildTree([second, first]))).toEqual(["first", "second"]);
});

test("a step with no parent left, or only a circular one, is dropped rather than fatal", () => {
  const rows = [
    step({ id: "ok", name: "runs" }),
    step({ id: "orphan", name: "orphan", parentId: "gone", branch: "yes" }),
    step({ id: "c1", name: "loop a", parentId: "c2" }),
    step({ id: "c2", name: "loop b", parentId: "c1" }),
  ];
  expect(names(flow.buildTree(rows))).toEqual(["runs"]);
});

test("what a step is shown depends on its context mode", () => {
  const context = [
    { name: "read", output: "five emails" },
    { name: "sort", output: "two are errors" },
  ];

  expect(flow.renderPrompt({ prompt: "go", context: "none" }, context)).toBe("go");

  const previous = flow.renderPrompt({ prompt: "go", context: "previous" }, context);
  expect(previous).toContain("two are errors");
  expect(previous).not.toContain("five emails");
  expect(previous.endsWith("go")).toBe(true);

  const all = flow.renderPrompt({ prompt: "go", context: "all" }, context);
  expect(all).toContain("### read");
  expect(all).toContain("### sort");
  expect(all.endsWith("go")).toBe(true);

  // Nothing has run yet, so there is no preamble to write.
  expect(flow.renderPrompt({ prompt: "go", context: "all" }, [])).toBe("go");
});

test("a prompt that places the earlier output itself gets that and no preamble", () => {
  const context = [
    { name: "read", output: "five emails" },
    { name: "sort", output: "two are errors" },
  ];

  expect(flow.renderPrompt({ prompt: "write {{previous}} down", context: "all" }, context)).toBe(
    "write two are errors down",
  );
  expect(flow.renderPrompt({ prompt: "from {{ steps.read }}", context: "all" }, context)).toBe(
    "from five emails",
  );
  // Naming a step that has not run says so, rather than substituting silence.
  expect(flow.renderPrompt({ prompt: "{{steps.nope}}", context: "all" }, context)).toBe(
    '(no step named "nope" has run)',
  );
});

test("{{event}} is the webhook body, pretty-printed", () => {
  const payload = { ref: "refs/heads/main", commits: [{ id: "abc" }] };
  const rendered = flow.renderPrompt({ prompt: "handle {{event}}", context: "none" }, [], payload);
  expect(rendered).toBe(`handle ${JSON.stringify(payload, null, 2)}`);

  // A run no webhook started, and a delivery whose body could not be kept, read the same: the
  // prompt only needs to know the payload is not there.
  const none = "(this run has no event payload)";
  expect(flow.renderPrompt({ prompt: "{{event}}", context: "none" }, [])).toBe(none);
  expect(flow.renderPrompt({ prompt: "{{event}}", context: "none" }, [], null)).toBe(none);
});

test("{{event}} is not step context, so it does not take the preamble with it", () => {
  const context = [{ name: "read", output: "five emails" }];

  // `{{previous}}` says where the earlier output goes and suppresses the preamble. `{{event}}`
  // says nothing about it, so a prompt that only asks for the payload still gets both.
  const both = flow.renderPrompt({ prompt: "on {{event}}", context: "all" }, context, { a: 1 });
  expect(both).toContain("### read");
  expect(both).toContain('"a": 1');
  expect(both.endsWith('on {\n  "a": 1\n}')).toBe(true);

  const placed = flow.renderPrompt(
    { prompt: "{{event}} then {{previous}}", context: "all" },
    context,
    { a: 1 },
  );
  expect(placed).toBe('{\n  "a": 1\n} then five emails');
});

test("the arm is read off the last answer, not the first mention of a label", () => {
  const cases = ["error", "clean"];
  expect(flow.parseCase('{"case": "error"}', cases)).toBe("error");
  expect(
    flow.parseCase('I first thought {"case": "error"} but no.\n{"case": "clean"}', cases),
  ).toBe("clean");
  // A model that answers in prose still tends to end on the answer.
  expect(flow.parseCase("Nothing looks wrong here.\n**clean**", cases)).toBe("clean");
  expect(flow.parseCase("Clean.", cases)).toBe("clean");
  expect(flow.parseCase("hard to say either way", cases)).toBeUndefined();
  // An answer that is not on offer is not an answer.
  expect(flow.parseCase('{"case": "maybe"}', cases)).toBeUndefined();
});

test("the decision instruction offers exactly the arms it was given", () => {
  expect(flow.decisionInstruction(["error", "clean"])).toContain(
    '{"case": "<one of: error, clean>"}',
  );
});
