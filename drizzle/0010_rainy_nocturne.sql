-- migration-phase: expand
CREATE TABLE "calendar_connection" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"google_account_id" text,
	"scope" text NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"refresh_token_nonce" text NOT NULL,
	"refresh_token_auth_tag" text NOT NULL,
	"refresh_token_key_version" integer NOT NULL,
	"primary_calendar_id" text,
	"primary_time_zone" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_selection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"google_calendar_id" text NOT NULL,
	"summary" text NOT NULL,
	"access_role" text NOT NULL,
	"time_zone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"is_writable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_connection" ADD CONSTRAINT "calendar_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_selection" ADD CONSTRAINT "calendar_selection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_selection_account_calendar_idx" ON "calendar_selection" USING btree ("user_id","google_calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_selection_one_writable_idx" ON "calendar_selection" USING btree ("user_id") WHERE is_writable;