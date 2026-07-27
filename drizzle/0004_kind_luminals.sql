-- migration-phase: expand
CREATE TABLE "thought" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"source_inbox_item_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"last_mutation_key" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "classified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thought" ADD CONSTRAINT "thought_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thought" ADD CONSTRAINT "thought_source_inbox_item_id_inbox_item_id_fk" FOREIGN KEY ("source_inbox_item_id") REFERENCES "public"."inbox_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thought_account_updated_idx" ON "thought" USING btree ("user_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "thought_tombstone_purge_idx" ON "thought" USING btree ("deleted_at");
