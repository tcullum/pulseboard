import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const telemetrySnapshots = sqliteTable("telemetry_snapshots", {
  id: integer("id").primaryKey(),
  payload: text("payload").notNull(),
  capturedAt: text("captured_at").notNull(),
  receivedAt: text("received_at").notNull(),
});
