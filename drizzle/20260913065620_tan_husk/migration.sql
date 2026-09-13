ALTER TABLE "mcp_servers" ADD COLUMN "hiddenTools" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "hooks" jsonb;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "hooks" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "hooks" jsonb;