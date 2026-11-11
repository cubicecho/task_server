ALTER TABLE "agents" ADD COLUMN "reasoningReplay" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "reasoningReplay" text DEFAULT 'all' NOT NULL;