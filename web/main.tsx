import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { router } from "@/router";
import "./index.css";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { quiet?: boolean };
  }
}

/**
 * The query client, made under the toast provider rather than beside it: a failed mutation is
 * said in a toast, and the toast is a hook's to raise.
 */
function App() {
  const toast = useToast();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Every mutation in the app answers a failure the same way — say what went wrong, and
        // leave the form as the user left it — and each one used to say so itself, in the same
        // line written fourteen times. A mutation's own `onError` runs after this one rather
        // than instead of it, so one that says its failure somewhere better — beside the field
        // it is about — sets `meta: { quiet: true }` to keep it from being said twice.
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) => {
            if (!mutation.meta?.quiet) {
              toast(error.message);
            }
          },
        }),
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            // Cache-and-network: `staleTime: 0` means every mount refetches, but the cached
            // result is rendered the whole time and only replaced once the server answers — a
            // revisited page shows what it showed before, never a spinner or a blank. That
            // falls out of `isPending` (no data at all) being distinct from `isFetching` (a
            // request in flight), so the views gate their loading states on `isPending` alone.
            //
            // `gcTime` is what keeps the cache there to render: an unused result is dropped
            // after it, and the 5-minute default meant a page returned to later had nothing to
            // show.
            staleTime: 0,
            gcTime: 30 * 60_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root is missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
