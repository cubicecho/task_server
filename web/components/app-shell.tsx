import { createLink, Outlet, useRouterState } from "@tanstack/react-router";
import { Activity, Bot, History, ListChecks, SlidersHorizontal, Zap } from "lucide-react";
import { BarNavItem, Sidebar, SidebarNavItem, SidebarSection } from "@/components/sidebar";
import { SidebarLayout } from "@/components/split-layout";
import { Plug } from "@/components/ui/icons";

const NAV = [
  { to: "/status", label: "Status", icon: Activity },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/runs", label: "Runs", icon: History },
  { to: "/servers", label: "MCP servers", icon: Plug },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal },
] as const;

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
        />
      }
      brandSlot={<Zap className="size-4" aria-label="task-server" />}
      navSlot={NAV.map(({ to, label, icon: Icon }) => (
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
