import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

/**
 * Each page is its own chunk, fetched when it is first needed.
 *
 * Statically imported, every route was in the one bundle the browser waits for before it can
 * draw anything — and most of a page's weight is the editor or the markdown it alone uses.
 * `defaultPreload: "intent"` below starts the fetch on hover, so a chunk is usually already
 * there by the time the click lands and the split costs no perceived delay.
 *
 * `AppShell` is not lazy: it is the frame every route renders inside.
 */
const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/tasks" });
  },
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status",
  component: lazyRouteComponent(() => import("@/routes/status"), "StatusRoute"),
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  component: lazyRouteComponent(() => import("@/routes/tasks"), "TasksRoute"),
});

// Both edit pages are the same component: whether it creates or edits is whether the route
// gave it an id. `/tasks/new` is declared first so it is not read as a task called "new".
const taskNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/new",
  component: lazyRouteComponent(() => import("@/routes/task-edit"), "TaskEditRoute"),
});

const taskEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$taskId",
  component: lazyRouteComponent(() => import("@/routes/task-edit"), "TaskEditRoute"),
});

const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs",
  component: lazyRouteComponent(() => import("@/routes/runs"), "RunsRoute"),
});

const mcpRoute = createRoute({
  getParentRoute: () => rootRoute,
  // Not `/mcp`: that path is the MCP endpoint the server answers on, and in dev the vite
  // proxy would hand this page to it.
  path: "/servers",
  component: lazyRouteComponent(() => import("@/routes/mcp"), "McpRoute"),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("@/routes/settings"), "SettingsRoute"),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    statusRoute,
    tasksRoute,
    taskNewRoute,
    taskEditRoute,
    runsRoute,
    mcpRoute,
    settingsRoute,
  ]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
