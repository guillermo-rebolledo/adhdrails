-- migration-phase: expand
CREATE TABLE "inbox_item_tombstone" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_item_tombstone" ADD CONSTRAINT "inbox_item_tombstone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;