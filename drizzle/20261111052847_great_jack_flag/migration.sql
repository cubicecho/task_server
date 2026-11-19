ALTER TABLE "agents" ADD COLUMN "serverInstructions" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "trustAnnotations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "serverInstructions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "toolExecution" SET DEFAULT 'auto';