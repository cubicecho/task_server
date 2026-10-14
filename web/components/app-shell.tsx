import { createLink, Outlet, useRouterState } from "@tanstack/react-router";
import { Activity, History, ListChecks, Zap } from "lucide-react";
import { BarNavItem, Sidebar, SidebarNavItem, SidebarSection } from "@/components/sidebar";
import { SidebarLayout } from "@/components/split-layout";
import { Settings } from "@/components/ui/icons";

const NAV = [
  { to: "/status", label: "Status", icon: Activity },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/runs", label: "Runs", icon: History },
] as const;

// At the foot of the sidebar, as telos and the rest of the ecosystem keep it. Agent profiles and
// MCP servers are tabs of it rather than places of their own: they are configured once and
// visited rarely, where the three above are where the work is.
const SETTINGS = { to: "/settings", label: "Settings", icon: Settings } as const;

// The row and the bar's icon name no router; the router supplies the `href` and the click.
const SidebarLink = createLink(SidebarNavItem);
const BarLink = createLink(BarNavItem);

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2 py-1 font-semibold text-sm tracking-tight">
      <Zap className="size-4" />
      task-server
    </div>
  );
}

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <SidebarLayout
      className="h-svh w-screen overflow-hidden bg-background text-foreground"
      sidebarPosition="start"
      sidebarWidth="auto"
      divider="none"
      sidebarHideBelow="md"
      sidebarSlot={
        <Sidebar
          label="Main"
          headerSlot={<Brand />}
          contentSlot={
            <SidebarSection
              as="nav"
              label="Main"
              contentSlot={NAV.map(({ to, label, icon: Icon }) => (
                <SidebarLink
                  key={to}
                  to={to}
                  label={label}
                  iconSlot={<Icon />}
                  active={pathname.startsWith(to)}
                />
              ))}
            />
          }
          footerSlot={
            <SidebarLink
              to={SETTINGS.to}
              label={SETTINGS.label}
              iconSlot={<SETTINGS.icon />}
              active={pathname.startsWith(SETTINGS.to)}
            />
          }
        />
      }
      brandSlot={<Zap className="size-4" aria-label="task-server" />}
      navSlot={[...NAV, SETTINGS].map(({ to, label, icon: Icon }) => (
        <BarLink
          key={to}
          to={to}
          label={label}
          iconSlot={<Icon />}
          active={pathname.startsWith(to)}
        />
      ))}
      navLabel="Main"
      contentSlot={<Outlet />}
    />
  );
}
