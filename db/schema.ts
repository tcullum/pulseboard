import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const telemetrySnapshots = sqliteTable("telemetry_snapshots", {
  id: integer("id").primaryKey(),
  payload: text("payload").notNull(),
  capturedAt: text("captured_at").notNull(),
  receivedAt: text("received_at").notNull(),
});

export const telemetryDevices = sqliteTable("telemetry_devices", {
  deviceId: text("device_id").primaryKey(),
  payload: text("payload").notNull(),
  capturedAt: text("captured_at").notNull(),
  receivedAt: text("received_at").notNull(),
});

export const dockerCommands = sqliteTable("docker_commands", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  containerName: text("container_name").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: text("requested_at").notNull(),
  claimedAt: text("claimed_at"),
  completedAt: text("completed_at"),
  result: text("result"),
});
