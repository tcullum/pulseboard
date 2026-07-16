import { env } from "cloudflare:workers";

type TelemetryRow = {
  payload: string;
  captured_at: string;
  received_at: string;
};

function database() {
  const runtime = env as unknown as { DB?: D1Database };
  if (!runtime.DB) throw new Error("Telemetry database is unavailable");
  return runtime.DB;
}

async function ensureTelemetryTable() {
  await database().prepare(`
    CREATE TABLE IF NOT EXISTS telemetry_snapshots (
      id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL
    )
  `).run();
}

export async function saveLatestTelemetry(payload: string, capturedAt: string) {
  await ensureTelemetryTable();
  const receivedAt = new Date().toISOString();
  await database().prepare(`
    INSERT INTO telemetry_snapshots (id, payload, captured_at, received_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      captured_at = excluded.captured_at,
      received_at = excluded.received_at
  `).bind(payload, capturedAt, receivedAt).run();
  return receivedAt;
}

export async function getLatestTelemetry() {
  await ensureTelemetryTable();
  return database().prepare(
    "SELECT payload, captured_at, received_at FROM telemetry_snapshots WHERE id = 1",
  ).first<TelemetryRow>();
}
