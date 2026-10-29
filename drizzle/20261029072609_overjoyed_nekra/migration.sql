ALTER TABLE "agents" ADD COLUMN "toolExecution" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "toolExecution" text DEFAULT 'sequential' NOT NULL;