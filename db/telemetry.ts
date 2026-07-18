import { env } from "cloudflare:workers";

type TelemetryRow = {
  device_id?: string;
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
  const d1 = database();
  await d1.batch([
    d1.prepare(`
    CREATE TABLE IF NOT EXISTS telemetry_snapshots (
      id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL
    )
  `),
    d1.prepare(`
    CREATE TABLE IF NOT EXISTS telemetry_devices (
      device_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL
    )
  `),
  ]);
}

export function telemetryDeviceId(payload: string, fallback = "macbook") {
  try {
    const parsed = JSON.parse(payload) as { device?: { id?: unknown; name?: unknown; platform?: unknown } };
    const raw = parsed.device?.id || `${parsed.device?.platform || "device"}-${parsed.device?.name || fallback}`;
    return String(raw).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
  } catch {
    return fallback;
  }
}

export async function saveLatestTelemetry(payload: string, capturedAt: string, deviceId = telemetryDeviceId(payload)) {
  await ensureTelemetryTable();
  const receivedAt = new Date().toISOString();
  const d1 = database();
  await d1.batch([
    d1.prepare(`
    INSERT INTO telemetry_snapshots (id, payload, captured_at, received_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      captured_at = excluded.captured_at,
      received_at = excluded.received_at
  `).bind(payload, capturedAt, receivedAt),
    d1.prepare(`
    INSERT INTO telemetry_devices (device_id, payload, captured_at, received_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      payload = excluded.payload,
      captured_at = excluded.captured_at,
      received_at = excluded.received_at
  `).bind(deviceId, payload, capturedAt, receivedAt),
  ]);
  return receivedAt;
}

export async function getLatestTelemetry(deviceId?: string | null) {
  await ensureTelemetryTable();
  if (deviceId) {
    return database().prepare(
      "SELECT device_id, payload, captured_at, received_at FROM telemetry_devices WHERE device_id = ?",
    ).bind(deviceId).first<TelemetryRow>();
  }
  const newest = await database().prepare(
    "SELECT device_id, payload, captured_at, received_at FROM telemetry_devices ORDER BY received_at DESC LIMIT 1",
  ).first<TelemetryRow>();
  if (newest) return newest;
  return database().prepare(
    "SELECT payload, captured_at, received_at FROM telemetry_snapshots WHERE id = 1",
  ).first<TelemetryRow>();
}

export async function listTelemetryDevices() {
  await ensureTelemetryTable();
  return database().prepare(
    "SELECT device_id, payload, captured_at, received_at FROM telemetry_devices ORDER BY received_at DESC",
  ).all<TelemetryRow>();
}
