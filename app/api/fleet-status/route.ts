import { env } from "cloudflare:workers";
import { listTelemetryDevices } from "../../../db/telemetry";

export const dynamic = "force-dynamic";

type Platform = "macos" | "windows" | "linux";
type FleetStatus = "online" | "stale" | "offline";

const SLOTS: Array<{ id: string; name: string; platform: Platform }> = [
  { id: "macbook", name: "Thomas's MacBook Pro", platform: "macos" },
  { id: "windows-plex", name: "Windows Plex", platform: "windows" },
  { id: "fedora", name: "Linux Dell Fedora", platform: "linux" },
];

function runtimeToken() {
  return (env as unknown as { PULSEBOARD_STATUS_TOKEN?: string }).PULSEBOARD_STATUS_TOKEN || "";
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

function statusForAge(ageSeconds: number): FleetStatus {
  if (ageSeconds <= 30) return "online";
  if (ageSeconds <= 90) return "stale";
  return "offline";
}

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!(await secureEqual(suppliedToken, runtimeToken()))) {
    return Response.json({ error: "Invalid status credential" }, { status: 401 });
  }

  const rows = await listTelemetryDevices();
  const byPlatform = new Map<Platform, {
    id: string;
    name: string;
    platform: Platform;
    ageSeconds: number;
    status: FleetStatus;
    lastSeenAt: string;
  }>();

  for (const row of rows.results) {
    try {
      const telemetry = JSON.parse(row.payload) as {
        device?: { id?: string; name?: string; platform?: string };
      };
      const platform = telemetry.device?.platform as Platform | undefined;
      if (!platform || !SLOTS.some((slot) => slot.platform === platform) || byPlatform.has(platform)) continue;
      const slot = SLOTS.find((item) => item.platform === platform)!;
      const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(row.received_at)) / 1000));
      byPlatform.set(platform, {
        id: row.device_id || telemetry.device?.id || slot.id,
        name: slot.name,
        platform,
        ageSeconds,
        status: statusForAge(ageSeconds),
        lastSeenAt: row.received_at,
      });
    } catch {
      // Ignore malformed legacy telemetry rows.
    }
  }

  const devices = SLOTS.map((slot) => byPlatform.get(slot.platform) || {
    ...slot,
    ageSeconds: null,
    status: "offline" as const,
    lastSeenAt: null,
  });

  return Response.json({
    generatedAt: new Date().toISOString(),
    staleAfterSeconds: 30,
    devices,
  }, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}
