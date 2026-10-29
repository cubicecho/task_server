ALTER TABLE "agents" ADD COLUMN "compactionModel" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "compactionModel" text DEFAULT '' NOT NULL;