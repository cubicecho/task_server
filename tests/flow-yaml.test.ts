import { expect, test } from "vitest";
import type { StepFieldsFragment } from "@/gql/graphql";
import { fromYaml, toDraft, toInput, toYaml } from "@/lib/flow";

/**
 * The editor's two tabs are one tree seen twice, so what matters is that the trip between them
 * loses nothing — least of all the ids, which are what keep a run's history attached to the
 * steps it ran.
 */

// Loosely typed on the way in: `kind` and `context` are codegen enums, and spelling them out
// here would say nothing the literal does not.
const row = (values: Record<string, unknown> & { id: string }): StepFieldsFragment =>
  ({
    parentId: null,
    branch: "",
    position: 0,
    kind: "agent",
    name: "",
    prompt: "do it",
    cases: null,
    model: "",
    systemPrompt: "",
    context: "all",
    enabled: true,
    ...values,
  }) as StepFieldsFragment;

// mail → decision(error | clean) → one step under each arm, and a last step after the lot.
const ROWS: StepFieldsFragment[] = [
  row({ id: "a", position: 0, name: "mail", prompt: "list my last 5 emails" }),
  row({
    id: "b",
    position: 1,
    kind: "decision",
    name: "any errors?",
    prompt: "do any report an application error?",
    cases: ["error", "clean"],
  }),
  row({
    id: "c",
    parentId: "b",
    branch: "error",
    position: 2,
    name: "write it up",
    prompt: "write {{previous}} to ~/notes/errors.md",
    context: "previous",
  }),
  row({
    id: "d",
    parentId: "b",
    branch: "clean",
    position: 3,
    name: "print them",
    prompt: "print the subject lines",
    model: "llama3.1:8b",
    enabled: false,
  }),
  row({ id: "e", position: 4, name: "sign off", prompt: "say goodnight" }),
];

test("the flat rows become the tree they describe", () => {
  const tree = toDraft(ROWS);
  expect(tree.map((step) => step.name)).toEqual(["mail", "any errors?", "sign off"]);

  const decision = tree[1];
  expect(decision.kind).toBe("decision");
  // Every declared case has an arm, in the order the cases were declared.
  expect(decision.branches.map((branch) => branch.case)).toEqual(["error", "clean"]);
  expect(decision.branches[0].steps.map((step) => step.id)).toEqual(["c"]);
  expect(decision.branches[1].steps[0].enabled).toBe(false);
});

test("a round trip through the text tab changes nothing, ids included", () => {
  const tree = toDraft(ROWS);
  const there = toYaml(tree);
  const back = fromYaml(there);

  expect(toInput(back)).toEqual(toInput(tree));
  // And serialising what came back is byte-identical, so the tab does not churn on open.
  expect(toYaml(back)).toBe(there);
  expect(there).toContain("id: c");
});

test("JSON is YAML, and branches may be a list as well as a map", () => {
  const asList = JSON.stringify([
    {
      kind: "decision",
      name: "any errors?",
      prompt: "well?",
      cases: ["error", "clean"],
      branches: [{ case: "error", steps: [{ prompt: "write it up" }] }],
    },
  ]);
  const tree = fromYaml(asList);
  expect(tree[0].branches.map((branch) => branch.case)).toEqual(["error", "clean"]);
  expect(tree[0].branches[0].steps[0].prompt).toBe("write it up");
  // A step pasted in without one is new, and the server gives it an id when it lands.
  expect(tree[0].id).toBeUndefined();
});

test("nothing it cannot understand is quietly dropped", () => {
  const cases: [string, RegExp][] = [
    ["- name: no prompt here\n", /has no prompt/],
    ["- prompt: hi\n  promt: typo\n", /unknown field "promt"/],
    ["- prompt: hi\n  kind: maybe\n", /expected agent or decision/],
    ["- prompt: hi\n  context: some\n", /expected all, previous or none/],
    ["- prompt: hi\n  kind: decision\n", /needs at least one case/],
    [
      "- prompt: hi\n  kind: decision\n  cases: [error]\n  branches:\n    clean:\n      - prompt: no\n",
      /not one of its cases/,
    ],
    ["prompt: hi\n", /should be a list of steps/],
  ];
  for (const [text, message] of cases) expect(() => fromYaml(text)).toThrow(message);

  // An empty flow is a flow with no steps, not a parse failure.
  expect(fromYaml("   ")).toEqual([]);
});
