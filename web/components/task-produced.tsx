import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { TaskArtifactsDocument } from "@/__generated__/graphql/graphql";
import { LoadState } from "@/components/load-state";
import { ArtifactList } from "@/components/run-outputs";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { RotateCcwClock } from "@/components/ui/icons";
import { request } from "@/lib/gql";

const PAGE = 20;

const DESCRIPTION =
  "One row per document, as the run that last linked it left it. A document moved or deleted " +
  "on its server keeps its old link here, and the list reaches back only as far as runs are kept.";

/**
 * What a task has made across all its runs: the answer to "where is the doc this task keeps
 * updating" without opening its runs one at a time.
 *
 * The collapse to one row per uri is the server's (`distinct` in `TaskArtifacts`), so a page of
 * twenty is twenty documents however many times each was rewritten. One row more than is shown
 * is asked for, so "Show more" is offered only when there is more to show.
 *
 * Nothing at all when the task has made nothing, which is most tasks.
 */
export function TaskProduced({ taskId }: { taskId: string }) {
  const [limit, setLimit] = useState(PAGE);
  const produced = useQuery({
    queryKey: ["task-artifacts", taskId, limit],
    queryFn: () => request(TaskArtifactsDocument, { taskId, limit: limit + 1 }),
    // Growing the page keeps the rows already drawn rather than blanking the section.
    placeholderData: (previous) => previous,
  });
  const rows = produced.data?.runArtifacts ?? [];

  if (rows.length === 0 && !produced.isError) {
    return null;
  }

  return (
    <Section
      title="Produced"
      description={DESCRIPTION}
      contentSlot={
        rows.length === 0 ? (
          <LoadState query={produced} what="what this task has produced" count={0} />
        ) : (
          <div className="flex flex-col gap-2">
            <ArtifactList
              label="Produced"
              artifacts={rows.slice(0, limit)}
              meta={(artifact) =>
                [
                  artifact.serverSlug,
                  artifact.lastModified
                    ? `modified ${new Date(artifact.lastModified).toLocaleDateString()}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
              leadingActionSlot={(artifact, label) => (
                <Button
                  aria-label={`The run that last linked ${label}`}
                  variant="outline"
                  size="icon"
                  hint={`Last linked ${new Date(artifact.updatedAt).toLocaleString()}`}
                  linkSlot={<Link to="/runs" search={{ run: artifact.runId }} />}
                  iconSlot={<RotateCcwClock />}
                />
              )}
            />
            {rows.length > limit ? (
              <div>
                <Button
                  variant="outline"
                  onClick={() => setLimit(limit + PAGE)}
                  disabled={produced.isFetching}
                  content="Show more"
                />
              </div>
            ) : null}
          </div>
        )
      }
    />
  );
}
