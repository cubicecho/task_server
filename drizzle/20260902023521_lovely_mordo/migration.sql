ALTER TABLE "runs" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "blockedBy" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_blockedBy_runs_id_fkey" FOREIGN KEY ("blockedBy") REFERENCES "runs"("id") ON DELETE SET NULL;