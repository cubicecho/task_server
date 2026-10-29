CREATE TABLE "endpoint_capabilities" (
	"id" text PRIMARY KEY DEFAULT 'default',
	"snapshot" jsonb NOT NULL,
	"savedAt" timestamp with time zone NOT NULL
);
