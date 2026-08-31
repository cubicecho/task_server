import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { McpRoute } from "@/routes/mcp";
import { RunsRoute } from "@/routes/runs";
import { SettingsRoute } from "@/routes/settings";
import { TasksRoute } from "@/routes/tasks";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/tasks" });
  },
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  component: TasksRoute,
});

const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs",
  component: RunsRoute,
});

const mcpRoute = createRoute({
  getParentRoute: () => rootRoute,
  // Not `/mcp`: that path is the MCP endpoint the server answers on, and in dev the vite
  // proxy would hand this page to it.
  path: "/servers",
  component: McpRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsRoute,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, tasksRoute, runsRoute, mcpRoute, settingsRoute]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
