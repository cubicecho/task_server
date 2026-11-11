CREATE TABLE "run_artifacts" (
	"id" text PRIMARY KEY,
	"runId" text NOT NULL,
	"runStepId" text,
	"taskId" text NOT NULL,
	"serverId" text,
	"serverSlug" text DEFAULT '' NOT NULL,
	"tool" text DEFAULT '' NOT NULL,
	"uri" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"mimeType" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"lastModified" timestamp with time zone,
	"webUrl" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "run_artifacts_run_uri_idx" ON "run_artifacts" ("runId","uri");--> statement-breakpoint
CREATE INDEX "run_artifacts_task_updated_idx" ON "run_artifacts" ("taskId","updatedAt");--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_runId_runs_id_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_runStepId_run_steps_id_fkey" FOREIGN KEY ("runStepId") REFERENCES "run_steps"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_taskId_tasks_id_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_serverId_mcp_servers_id_fkey" FOREIGN KEY ("serverId") REFERENCES "mcp_servers"("id") ON DELETE SET NULL;