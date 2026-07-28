-- migration-phase: expand
CREATE TABLE "focus_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"accumulated_seconds" integer DEFAULT 0 NOT NULL,
	"last_resumed_at" timestamp with time zone,
	"distraction_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "focus_session" ADD CONSTRAINT "focus_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_session" ADD CONSTRAINT "focus_session_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "focus_session_one_active_idx" ON "focus_session" USING btree ("user_id") WHERE status <> 'completed';--> statement-breakpoint
CREATE INDEX "focus_session_account_completed_idx" ON "focus_session" USING btree ("user_id","completed_at");