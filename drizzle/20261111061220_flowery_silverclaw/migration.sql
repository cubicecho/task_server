ALTER TABLE "mcp_servers" ADD COLUMN "logLevel" text DEFAULT 'warning';--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "serverLogs" jsonb;