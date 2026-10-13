import { expect, test } from "vitest";
import { isBlank, triggerProblem } from "@/lib/triggers";

const cron = (over: object = {}) => ({ kind: "cron" as const, cron: "", event: "", ...over });
const webhook = (over: object = {}) => ({ kind: "event" as const, cron: "", event: "", ...over });

test("a trigger is blank when the value its own kind needs is missing", () => {
  expect(isBlank(cron())).toBe(true);
  expect(isBlank(cron({ cron: "   " }))).toBe(true);
  expect(isBlank(cron({ cron: "0 9 * * *" }))).toBe(false);
  // The other kind's column is not this one's value, however full it is.
  expect(isBlank(cron({ event: "abc" }))).toBe(true);
  expect(isBlank(webhook({ cron: "0 9 * * *" }))).toBe(true);
  expect(isBlank(webhook({ event: "abc" }))).toBe(false);
});

test("a blank row that was never saved is not a problem — the save leaves it out", () => {
  expect(triggerProblem(cron())).toBeUndefined();
  expect(triggerProblem(webhook())).toBeUndefined();
});

test("a saved trigger that was blanked is refused, because the stored one would keep firing", () => {
  expect(triggerProblem(cron({ id: "t1" }))).toBeDefined();
  expect(triggerProblem(webhook({ id: "t2", event: "  " }))).toBeDefined();
});

test("a saved trigger that still has its value is fine", () => {
  expect(triggerProblem(cron({ id: "t1", cron: "0 9 * * *" }))).toBeUndefined();
  expect(triggerProblem(webhook({ id: "t2", event: "abc" }))).toBeUndefined();
});
