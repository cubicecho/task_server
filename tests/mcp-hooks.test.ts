import { HOOK_EVENTS } from "@cubicecho/agent-mcp-pool/hooks";
import { expect, test } from "vitest";
import { HOOK_EVENTS_FIRED, HOOK_PLACEHOLDER, hooksProblem } from "../web/lib/mcp-hooks.ts";

test("fires every pool event but beforeCompact", () => {
  expect(HOOK_EVENTS_FIRED).toEqual(HOOK_EVENTS.filter((event) => event !== "beforeCompact"));
});

test("the placeholder is a hook the form accepts", () => {
  expect(hooksProblem(HOOK_PLACEHOLDER)).toBeUndefined();
  expect(hooksProblem("  ")).toBeUndefined();
});

test("reports the pool's first problem", () => {
  expect(hooksProblem("[")).toMatch(/valid JSON/);
  expect(hooksProblem("{}")).toMatch(/must be a list/);
  expect(hooksProblem(JSON.stringify([{ id: "a", on: "beforeTurn" }]))).toMatch(/needs a tool/);
  expect(
    hooksProblem(JSON.stringify([{ id: "a", on: "sessionEnd", tool: "t", inject: true }])),
  ).toMatch(/can inject/);
});

test("refuses an event this server never fires", () => {
  expect(hooksProblem(JSON.stringify([{ id: "c", on: "beforeCompact", tool: "t" }]))).toMatch(
    /never fires beforeCompact/,
  );
});
