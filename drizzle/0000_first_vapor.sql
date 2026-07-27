-- migration-phase: expand
CREATE TABLE "seed_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seed_records_name_unique" UNIQUE("name")
);
