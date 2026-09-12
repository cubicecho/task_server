import type {
  SettingsFieldsFragment,
  SettingsToolDiscoveryEnum,
  UpdateSettingInput,
} from "@/__generated__/graphql/graphql";

/**
 * The settings row as the Settings page edits it, and the panels it is split into.
 *
 * Pure, and apart from the page, because the part of that page that goes wrong is never the
 * drawing: it is which values the form holds and what it compares them against. The same shape
 * as kanban_server's and min-agent's settings, so the three pages read alike.
 */

/**
 * The panels behind `/settings`, in the order they are shown.
 *
 * Model leads because the model pickers on every other panel have nothing to list until it is
 * filled in. Connect edits nothing, and is here so that `?tab=connect` can be a link.
 */
export const SETTINGS_SECTIONS = [
  { key: "model", label: "Model" },
  { key: "limits", label: "Limits" },
  { key: "tools", label: "Tools" },
  { key: "server", label: "Server" },
  { key: "connect", label: "Connect" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["key"];

export const isSettingsSection = (value: unknown): value is SettingsSection =>
  SETTINGS_SECTIONS.some((section) => section.key === value);

export const sectionLabel = (key: SettingsSection) =>
  SETTINGS_SECTIONS.find((section) => section.key === key)?.label ?? key;

/**
 * The row as the form holds it: the numbers stay numbers, and a box emptied on the way to
 * retyping one is `null` rather than a silent zero — which the page's validator refuses, in the
 * field, instead of writing 0 to a column every task falls back to.
 */
export interface SettingsForm {
  baseUrl: string;
  /** Write-only: never read back, so empty means "keep the stored one". */
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens: number | null;
  temperature: number | null;
  maxToolIterations: number | null;
  requestTimeoutSeconds: number | null;
  maxRetries: number | null;
  toolDiscovery: SettingsToolDiscoveryEnum;
  toolSelectModel: string;
  maxConcurrentRuns: number | null;
  runRetentionDays: number | null;
}

/**
 * Which panel each field is on.
 *
 * Field-to-panel rather than panel-to-fields so that the `Record` has to be complete: a column
 * added to the form and placed nowhere is a type error here, rather than a field that never
 * marks its tab as holding a change.
 */
export const SECTION_OF: Record<keyof SettingsForm, Exclude<SettingsSection, "connect">> = {
  baseUrl: "model",
  apiKey: "model",
  model: "model",
  systemPrompt: "model",
  maxTokens: "limits",
  temperature: "limits",
  maxToolIterations: "limits",
  requestTimeoutSeconds: "limits",
  maxRetries: "limits",
  toolDiscovery: "tools",
  toolSelectModel: "tools",
  maxConcurrentRuns: "server",
  runRetentionDays: "server",
};

/** A form seeded from the stored row. The key box starts empty, which is what keeps the key. */
export const toForm = (row: SettingsFieldsFragment): SettingsForm => ({
  baseUrl: row.baseUrl,
  apiKey: "",
  model: row.model,
  systemPrompt: row.systemPrompt,
  maxTokens: row.maxTokens,
  temperature: row.temperature,
  maxToolIterations: row.maxToolIterations,
  requestTimeoutSeconds: row.requestTimeoutSeconds,
  maxRetries: row.maxRetries,
  toolDiscovery: row.toolDiscovery,
  toolSelectModel: row.toolSelectModel,
  maxConcurrentRuns: row.maxConcurrentRuns,
  runRetentionDays: row.runRetentionDays,
});

/**
 * The form as the `updateSettingSingle` input. The key is not in it: it travels on `setApiKey`,
 * being excluded from the type entirely. A `null` never reaches here past the validator; the
 * fallbacks only satisfy the type, and each is that column's own "off".
 */
export const toRow = (form: SettingsForm): UpdateSettingInput => ({
  baseUrl: form.baseUrl,
  model: form.model,
  systemPrompt: form.systemPrompt,
  maxTokens: form.maxTokens ?? 0,
  temperature: form.temperature ?? 0,
  maxToolIterations: form.maxToolIterations ?? 0,
  requestTimeoutSeconds: form.requestTimeoutSeconds ?? 0,
  maxRetries: form.maxRetries ?? 0,
  toolDiscovery: form.toolDiscovery,
  toolSelectModel: form.toolSelectModel,
  maxConcurrentRuns: form.maxConcurrentRuns ?? 0,
  runRetentionDays: form.runRetentionDays ?? 0,
});

/**
 * Which panels hold a change, in tab order, compared field by field against the row as it
 * stands — not against a snapshot from when the page opened, since a tab left open all
 * afternoon is exactly the one that would save over somebody else's edit.
 */
export function dirtySections(
  form: SettingsForm,
  row: SettingsFieldsFragment | undefined,
): SettingsSection[] {
  if (!row) return [];
  const stored = toForm(row);
  const dirty = new Set<SettingsSection>();
  for (const key of Object.keys(SECTION_OF) as (keyof SettingsForm)[]) {
    if (form[key] !== stored[key]) dirty.add(SECTION_OF[key]);
  }
  return SETTINGS_SECTIONS.map((section) => section.key).filter((key) => dirty.has(key));
}
