import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { claimDockerCommand, completeDockerCommand, createDockerCommand, getDockerCommand, type DockerAction } from "../../../db/docker-control";

export const dynamic = "force-dynamic";

const ACTIONS = new Set<DockerAction>(["start", "stop", "restart"]);
const DEVICE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CONTAINER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

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

async function isCompanion(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return secureEqual(suppliedToken, runtimeToken());
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (await isCompanion(request)) {
    const deviceId = url.searchParams.get("device") || "";
    if (!DEVICE_PATTERN.test(deviceId)) return Response.json({ error: "Invalid device" }, { status: 400 });
    const command = await claimDockerCommand(deviceId);
    return command
      ? Response.json({ command }, { headers: { "Cache-Control": "no-store" } })
      : new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const id = url.searchParams.get("id") || "";
  if (!id) return Response.json({ error: "Command id required" }, { status: 400 });
  const command = await getDockerCommand(id, user.email);
  return command
    ? Response.json({ command }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "Command not found" }, { status: 404 });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) return Response.json({ error: "Invalid JSON" }, { status: 400 });

  if (await isCompanion(request)) {
    const id = String(payload.id || "");
    const deviceId = String(payload.deviceId || "");
    const ok = payload.ok === true;
    const result = String(payload.result || (ok ? "Command completed" : "Command failed"));
    if (!id || !DEVICE_PATTERN.test(deviceId)) return Response.json({ error: "Invalid completion" }, { status: 400 });
    const completed = await completeDockerCommand(id, deviceId, ok, result);
    return completed ? Response.json({ ok: true }) : Response.json({ error: "Command is not active" }, { status: 409 });
  }

  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const deviceId = String(payload.deviceId || "");
  const containerName = String(payload.containerName || "");
  const action = String(payload.action || "") as DockerAction;
  if (!DEVICE_PATTERN.test(deviceId) || !CONTAINER_PATTERN.test(containerName) || !ACTIONS.has(action)) {
    return Response.json({ error: "Invalid Docker command" }, { status: 400 });
  }

  const command = await createDockerCommand(deviceId, containerName, action, user.email);
  return Response.json({ command: { ...command, status: "pending" } }, { status: 202 });
}
