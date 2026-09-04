CREATE TABLE "agents" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"baseUrl" text DEFAULT '' NOT NULL,
	"apiKey" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"systemPrompt" text DEFAULT '' NOT NULL,
	"maxTokens" integer DEFAULT -1 NOT NULL,
	"temperature" real DEFAULT -1 NOT NULL,
	"maxToolIterations" integer DEFAULT -1 NOT NULL,
	"toolDiscovery" text DEFAULT 'inherit' NOT NULL,
	"toolSelectModel" text DEFAULT '' NOT NULL,
	"requestTimeoutSeconds" integer DEFAULT -1 NOT NULL,
	"maxRetries" integer DEFAULT -1 NOT NULL,
	"mcpServerIds" jsonb,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "agentId" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agentId_agents_id_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL;