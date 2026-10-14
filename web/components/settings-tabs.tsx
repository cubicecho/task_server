import { useNavigate } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isSettingsSection, SETTINGS_SECTIONS, type SettingsSection } from "@/lib/settings-form";
import type { SlotNode } from "@/lib/utils";

/**
 * Every tab behind Settings, in one row: the panels of the settings row, then the two tables
 * that are configured rather than worked in.
 *
 * The panels are `?tab=` on `/settings`, one form under one Save; the two tables are routes of
 * their own, because each has its own query and its own header actions.
 */
const PAGES = {
  agents: { to: "/settings/agents", label: "Agents" },
  servers: { to: "/settings/servers", label: "MCP servers" },
} as const;

export type SettingsTab = SettingsSection | keyof typeof PAGES;

const TABS: readonly { key: SettingsTab; label: string }[] = [
  ...SETTINGS_SECTIONS,
  ...Object.entries(PAGES).map(([key, page]) => ({
    key: key as keyof typeof PAGES,
    label: page.label,
  })),
];

/**
 * The Tabs root around a whole settings page, so the list in its header and the panels in its
 * body are one set of tabs. `contents`, so the root draws no box of its own around the page.
 */
export function SettingsTabsRoot({
  current,
  contentSlot,
}: {
  current: SettingsTab;
  contentSlot: SlotNode;
}) {
  const navigate = useNavigate();

  const open = (next: string) => {
    if (isSettingsSection(next)) {
      // Between panels of one form, so a Back does not walk through every tab looked at.
      navigate({ to: "/settings", search: { tab: next }, replace: isSettingsSection(current) });
    } else if (next === "agents" || next === "servers") {
      navigate({ to: PAGES[next].to });
    }
  };

  return (
    <Tabs value={current} onValueChange={open} className="contents">
      {contentSlot}
    </Tabs>
  );
}

/** The row under every settings page's title. A dot marks a panel holding unsaved changes. */
export function SettingsTabList({ dirty = [] }: { dirty?: readonly SettingsTab[] }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <TabsList aria-label="Settings">
        {TABS.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
            {dirty.includes(tab.key) ? (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-info" />
                <span className="sr-only">(unsaved changes)</span>
              </>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
