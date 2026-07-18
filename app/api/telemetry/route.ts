import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getLatestTelemetry, listTelemetryDevices, saveLatestTelemetry, telemetryDeviceId } from "../../../db/telemetry";

export const dynamic = "force-dynamic";

const MAX_PAYLOAD_BYTES = 256 * 1024;

function runtimeToken() {
  return (env as unknown as { TELEMETRY_TOKEN?: string }).TELEMETRY_TOKEN || "";
}

async function secureEqual(left: string, right: string) {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function isTelemetryPayload(value: unknown): value is { timestamp: string; device: unknown; cpu: unknown; memory: unknown } {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.timestamp === "string" && !!payload.device && !!payload.cpu && !!payload.memory;
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const requestedDevice = new URL(request.url).searchParams.get("device");
  const [row, deviceRows] = await Promise.all([getLatestTelemetry(requestedDevice), listTelemetryDevices()]);
  if (!row) return Response.json({ error: "No telemetry received yet" }, { status: 404 });

  const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(row.received_at)) / 1000));
  const devices = deviceRows.results.map((deviceRow) => {
    const telemetry = JSON.parse(deviceRow.payload) as { device?: { id?: string; name?: string; platform?: string; os?: string; chip?: string } };
    const rowAgeSeconds = Math.max(0, Math.round((Date.now() - Date.parse(deviceRow.received_at)) / 1000));
    return {
      id: deviceRow.device_id || telemetry.device?.id || telemetryDeviceId(deviceRow.payload),
      name: telemetry.device?.name || "Pulseboard device",
      platform: telemetry.device?.platform || "macos",
      os: telemetry.device?.os || "",
      chip: telemetry.device?.chip || "",
      receivedAt: deviceRow.received_at,
      ageSeconds: rowAgeSeconds,
      stale: rowAgeSeconds > 30,
    };
  });
  return Response.json({
    telemetry: JSON.parse(row.payload),
    devices,
    source: "relay",
    receivedAt: row.received_at,
    ageSeconds,
    stale: ageSeconds > 30,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!(await secureEqual(suppliedToken, runtimeToken()))) {
    return Response.json({ error: "Invalid device credential" }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_PAYLOAD_BYTES) return Response.json({ error: "Payload too large" }, { status: 413 });

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PAYLOAD_BYTES) return Response.json({ error: "Payload too large" }, { status: 413 });

  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!isTelemetryPayload(payload)) return Response.json({ error: "Invalid telemetry payload" }, { status: 400 });

  const serialized = JSON.stringify(payload);
  const receivedAt = await saveLatestTelemetry(serialized, payload.timestamp, telemetryDeviceId(serialized));
  return Response.json({ ok: true, receivedAt }, { status: 202 });
}
