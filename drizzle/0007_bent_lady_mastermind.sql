-- migration-phase: expand
CREATE TABLE "area" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "scheduled_date" date;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "scheduled_time" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "energy" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "important" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "area" ADD CONSTRAINT "area_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "area_account_name_idx" ON "area" USING btree ("user_id","name");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_area_id_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_account_scheduled_idx" ON "task" USING btree ("user_id","scheduled_date","id");--> statement-breakpoint
CREATE INDEX "task_area_idx" ON "task" USING btree ("area_id");