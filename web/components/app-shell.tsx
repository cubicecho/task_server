import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Activity, Bot, History, ListChecks, Plug, SlidersHorizontal, Zap } from "lucide-react";
import { SidebarLayout } from "@/components/split-layout";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/status", label: "Status", icon: Activity },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/runs", label: "Runs", icon: History },
  { to: "/servers", label: "MCP servers", icon: Plug },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal },
] as const;

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <SidebarLayout
      className="h-screen w-screen overflow-hidden bg-background text-foreground"
      sidebarPosition="start"
      sidebarWidth="sm"
      stackBelow="md"
      divider="line"
      sidebarClassName="bg-sidebar"
      sidebar={
        <nav className="flex flex-col gap-1 px-2">
          <div className="flex items-center gap-2 px-3 py-4 font-semibold text-sm tracking-tight">
            <Zap className="size-4" />
            task-server
          </div>
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                pathname.startsWith(to) && "bg-accent font-medium text-accent-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      }
      content={<Outlet />}
    />
  );
}
