CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"label" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"transport" text DEFAULT 'stdio' NOT NULL,
	"command" text DEFAULT '' NOT NULL,
	"args" jsonb,
	"env" jsonb,
	"url" text DEFAULT '' NOT NULL,
	"headers" jsonb
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" text PRIMARY KEY,
	"runId" text NOT NULL,
	"stepId" text,
	"position" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'agent' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"startedAt" timestamp with time zone NOT NULL,
	"finishedAt" timestamp with time zone,
	"output" text DEFAULT '' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"toolCalls" jsonb,
	"promptTokens" integer DEFAULT 0 NOT NULL,
	"completionTokens" integer DEFAULT 0 NOT NULL,
	"totalTokens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY,
	"taskId" text NOT NULL,
	"triggerId" text,
	"status" text DEFAULT 'running' NOT NULL,
	"startedAt" timestamp with time zone NOT NULL,
	"finishedAt" timestamp with time zone,
	"output" text DEFAULT '' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"toolCalls" jsonb,
	"promptTokens" integer DEFAULT 0 NOT NULL,
	"completionTokens" integer DEFAULT 0 NOT NULL,
	"totalTokens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'default',
	"baseUrl" text DEFAULT 'http://localhost:11434/v1' NOT NULL,
	"apiKey" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"systemPrompt" text DEFAULT 'You are a task runner. Carry out the instruction using the tools available to you, then report what you did and what you found. Say plainly when something failed.' NOT NULL,
	"maxTokens" integer DEFAULT 4096 NOT NULL,
	"temperature" real DEFAULT 0.7 NOT NULL,
	"maxToolIterations" integer DEFAULT 20 NOT NULL,
	"toolDiscovery" text DEFAULT 'eager' NOT NULL,
	"toolSelectModel" text DEFAULT '' NOT NULL,
	"runRetentionDays" integer DEFAULT 0 NOT NULL,
	"requestTimeoutSeconds" integer DEFAULT 120 NOT NULL,
	"maxRetries" integer DEFAULT 2 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "steps" (
	"id" text PRIMARY KEY,
	"taskId" text NOT NULL,
	"parentId" text,
	"branch" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'agent' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"cases" jsonb,
	"model" text DEFAULT '' NOT NULL,
	"systemPrompt" text DEFAULT '' NOT NULL,
	"context" text DEFAULT 'all' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"systemPrompt" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"id" text PRIMARY KEY,
	"taskId" text NOT NULL,
	"kind" text DEFAULT 'cron' NOT NULL,
	"cron" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT '' NOT NULL,
	"event" text DEFAULT '' NOT NULL,
	"config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "run_steps_run_idx" ON "run_steps" ("runId");--> statement-breakpoint
CREATE INDEX "runs_task_idx" ON "runs" ("taskId");--> statement-breakpoint
CREATE INDEX "runs_started_idx" ON "runs" ("startedAt");--> statement-breakpoint
CREATE INDEX "steps_task_idx" ON "steps" ("taskId");--> statement-breakpoint
CREATE INDEX "steps_parent_idx" ON "steps" ("parentId");--> statement-breakpoint
CREATE INDEX "triggers_task_idx" ON "triggers" ("taskId");--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_runId_runs_id_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_stepId_steps_id_fkey" FOREIGN KEY ("stepId") REFERENCES "steps"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_taskId_tasks_id_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_triggerId_triggers_id_fkey" FOREIGN KEY ("triggerId") REFERENCES "triggers"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "steps" ADD CONSTRAINT "steps_taskId_tasks_id_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "steps" ADD CONSTRAINT "steps_parentId_steps_id_fkey" FOREIGN KEY ("parentId") REFERENCES "steps"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_taskId_tasks_id_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE;