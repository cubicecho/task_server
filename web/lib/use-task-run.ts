import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RunTaskDocument, StopTaskDocument } from "@/__generated__/graphql/graphql";
import { useToast } from "@/components/ui/toast";
import { request } from "@/lib/gql";

/** Every list a run starting, ending, being stopped or being deleted is drawn in. */
const SHOWN_IN = ["tasks", "runs", "status"];

/** Refetches every page that draws a run, for whichever mutation just changed one. */
export function useRefreshRuns() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of SHOWN_IN) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

/**
 * Starts a task by hand, from whichever page offers the button.
 *
 * `runTask` answers only when the run is over, so success here is not "started": it is an
 * outcome, and the toast says which. Written per page, one of the three announced a failed run
 * as a success.
 */
export function useRunTask() {
  const toast = useToast();
  const refresh = useRefreshRuns();
  return useMutation({
    mutationFn: (variables: { taskId: string; payload?: unknown }) =>
      request(RunTaskDocument, variables),
    onSuccess: ({ runTask: { status, error } }) => {
      if (status === "error") {
        toast(error || "Run failed");
      } else if (status === "stopped") {
        toast("Run stopped", "positive");
      } else {
        toast("Run finished", "positive");
      }
      refresh();
    },
  });
}

/** Stops a task's run. A run is stopped through its task: the runner keys what is in flight by task. */
export function useStopTask() {
  const toast = useToast();
  const refresh = useRefreshRuns();
  return useMutation({
    mutationFn: (taskId: string) => request(StopTaskDocument, { taskId }),
    onSuccess: ({ stopTask }) => {
      // False means the run had already finished on its own — nothing was stopped, and the
      // refresh is what shows that.
      if (stopTask) {
        toast("Stopping…", "info");
      }
      refresh();
    },
  });
}
