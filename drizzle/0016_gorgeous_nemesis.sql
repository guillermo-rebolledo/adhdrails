-- migration-phase: expand
CREATE TABLE "data_export" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" text,
	"byte_size" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_export" ADD CONSTRAINT "data_export_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_export_account_created_idx" ON "data_export" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_export_one_active_idx" ON "data_export" USING btree ("user_id") WHERE status in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "data_export_status_created_idx" ON "data_export" USING btree ("status","created_at","id");