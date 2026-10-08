import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RunTaskDocument, StopTaskDocument } from "@/__generated__/graphql/graphql";
import { request } from "@/lib/gql";

/** Every list a run starting, ending or being stopped is drawn in. */
const SHOWN_IN = ["tasks", "runs", "status"];

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of SHOWN_IN) queryClient.invalidateQueries({ queryKey: [key] });
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
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (variables: { taskId: string; payload?: unknown }) =>
      request(RunTaskDocument, variables),
    onSuccess: ({ runTask: { status, error } }) => {
      if (status === "error") toast.error(error || "Run failed");
      else if (status === "stopped") toast.success("Run stopped");
      else toast.success("Run finished");
      refresh();
    },
  });
}

/** Stops a task's run. A run is stopped through its task: the runner keys what is in flight by task. */
export function useStopTask() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (taskId: string) => request(StopTaskDocument, { taskId }),
    onSuccess: ({ stopTask }) => {
      // False means the run had already finished on its own — nothing was stopped, and the
      // refresh is what shows that.
      if (stopTask) toast.success("Stopping…");
      refresh();
    },
  });
}
