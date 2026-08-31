import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { router } from "@/router";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      // Cache-first: a cached result inside `staleTime` is used as-is, with no request at all,
      // so moving between pages is instant instead of refetching what we just had. Past it the
      // cache still renders immediately and the refetch happens behind it — never a spinner on
      // data we already hold. `gcTime` is how long an unused result is kept to be first with.
      //
      // Anything we change ourselves is invalidated by its mutation, which refetches regardless
      // of staleness: the cache is keyed by query, not normalised the way Apollo's is, so a
      // mutation result never quietly updates another query's copy of the same row. The window
      // only covers what the *server* changes on its own — a cron run, an agent over MCP — and
      // the pages where that matters poll on their own `refetchInterval`, which staleness does
      // not gate either.
      staleTime: 30_000,
      gcTime: 30 * 60_000,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);
