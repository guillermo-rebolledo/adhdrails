-- migration-phase: expand
CREATE INDEX "task_account_status_area_created_idx" ON "task" USING btree ("user_id","status","area_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_account_status_energy_created_idx" ON "task" USING btree ("user_id","status","energy","created_at","id");
