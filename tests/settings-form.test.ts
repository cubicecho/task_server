import { FormApi } from "@tanstack/react-form";
import { describe, expect, it } from "vitest";
import {
  type SettingsFieldsFragment,
  SettingsToolDiscoveryEnum,
} from "../web/__generated__/graphql/graphql.ts";
import { dirtySections, SECTION_OF, toForm, toRow } from "../web/lib/settings-form.ts";

const ROW: SettingsFieldsFragment = {
  id: "default",
  baseUrl: "http://localhost:11434/v1",
  model: "llama3.1:8b",
  systemPrompt: "",
  maxTokens: 4096,
  temperature: 0.2,
  maxToolIterations: 20,
  toolDiscovery: SettingsToolDiscoveryEnum.Eager,
  toolSelectModel: "",
  requestTimeoutSeconds: 120,
  maxRetries: 2,
  maxConcurrentRuns: 4,
  runRetentionDays: 30,
};

describe("settings form", () => {
  it("is clean when it is a copy of the row", () => {
    expect(dirtySections(toForm(ROW), ROW)).toEqual([]);
  });

  it("names every tab holding a change, in tab order", () => {
    const form = { ...toForm(ROW), maxConcurrentRuns: 8, maxRetries: 5, apiKey: "sk-x" };
    expect(dirtySections(form, ROW)).toEqual(["model", "limits", "server"]);
  });

  it("keeps the key out of the row it writes", () => {
    expect(toRow({ ...toForm(ROW), apiKey: "sk-x" })).not.toHaveProperty("apiKey");
  });

  it("writes every column the form places on a panel", () => {
    const placed = Object.keys(SECTION_OF).filter((key) => key !== "apiKey");
    expect(Object.keys(toRow(toForm(ROW))).sort()).toEqual(placed.sort());
  });

  // Built from blanks and then `reset` into the row, the next render handed the blanks back as
  // defaults and an untouched form took them. Built from the row, it holds.
  it("holds the loaded row across a re-render when its defaults are the row", () => {
    const form = new FormApi({ defaultValues: toForm(ROW) });
    form.mount();
    form.update({ defaultValues: toForm(ROW) });
    expect(form.state.values.baseUrl).toBe(ROW.baseUrl);

    const saved = { ...ROW, model: "qwen3:14b" };
    form.reset(toForm(saved));
    form.update({ defaultValues: toForm(saved) });
    expect(form.state.values.model).toBe("qwen3:14b");
  });
});
