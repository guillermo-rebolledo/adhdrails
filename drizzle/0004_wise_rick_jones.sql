-- migration-phase: expand
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"start_time_zone" text NOT NULL,
	"end_time_zone" text NOT NULL,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"all_day_start_date" date,
	"all_day_end_date" date,
	"recurring_event_id" text,
	"recurrence" text[],
	"status" text DEFAULT 'confirmed' NOT NULL,
	"origin" text DEFAULT 'local' NOT NULL,
	"google_calendar_id" text,
	"google_event_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_tombstone" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tombstone" ADD CONSTRAINT "event_tombstone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_account_start_idx" ON "event" USING btree ("user_id","start_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_google_identity_idx" ON "event" USING btree ("google_calendar_id","google_event_id");