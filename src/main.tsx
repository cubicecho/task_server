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
      // Cache-and-network: `staleTime: 0` means every mount refetches, but the cached result
      // is rendered the whole time and only replaced once the server answers — a revisited
      // page shows what it showed before, never a spinner or a blank. That falls out of
      // `isPending` (no data at all) being distinct from `isFetching` (a request in flight),
      // so the views gate their loading states on `isPending` alone.
      //
      // `gcTime` is what keeps the cache there to render: an unused result is dropped after
      // it, and the 5-minute default meant a page returned to later had nothing to show.
      staleTime: 0,
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
