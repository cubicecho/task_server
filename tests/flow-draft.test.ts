import { expect, test } from "vitest";
import type { StepFieldsFragment } from "@/__generated__/graphql/graphql";
import { toDraft } from "@/lib/flow";

/**
 * The server stores steps flat — each one naming its parent and the arm it sits in — and the
 * editor wants the tree they describe. `toDraft` is where that shape is rebuilt.
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
