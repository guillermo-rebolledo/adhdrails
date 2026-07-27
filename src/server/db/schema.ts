import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const seedRecords = pgTable("seed_records", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
