-- migration-phase: expand
CREATE TABLE "account_deletion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text,
	"pseudonymous_account_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"purge_after" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_reference" uuid,
	"action" text NOT NULL,
	"opaque_target" uuid,
	"outcome" text NOT NULL,
	"safe_code" text,
	"correlation_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_deletion" ADD CONSTRAINT "account_deletion_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_one_active_idx" ON "account_deletion" USING btree ("user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE INDEX "account_deletion_dispatch_idx" ON "account_deletion" USING btree ("status","requested_at","id");--> statement-breakpoint
CREATE INDEX "account_deletion_purge_idx" ON "account_deletion" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "operational_audit_account_time_idx" ON "operational_audit" USING btree ("account_reference","occurred_at");--> statement-breakpoint
CREATE INDEX "operational_audit_purge_idx" ON "operational_audit" USING btree ("purge_after");
