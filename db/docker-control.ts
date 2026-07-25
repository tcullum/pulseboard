import { env } from "cloudflare:workers";

export type DockerAction = "start" | "stop" | "restart";

export type DockerCommand = {
  id: string;
  device_id: string;
  container_name: string;
  action: DockerAction;
  status: "pending" | "processing" | "succeeded" | "failed";
  requested_by: string;
  requested_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  result: string | null;
};

function database() {
  const runtime = env as unknown as { DB?: D1Database };
  if (!runtime.DB) throw new Error("Docker command database is unavailable");
  return runtime.DB;
}

async function ensureDockerCommandsTable() {
  const d1 = database();
  await d1.batch([
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS docker_commands (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        container_name TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT,
        result TEXT
      )
    `),
    d1.prepare("CREATE INDEX IF NOT EXISTS docker_commands_device_status_idx ON docker_commands (device_id, status, requested_at)"),
  ]);
}

export async function createDockerCommand(deviceId: string, containerName: string, action: DockerAction, requestedBy: string) {
  await ensureDockerCommandsTable();
  const command = {
    id: crypto.randomUUID(),
    deviceId,
    containerName,
    action,
    requestedBy,
    requestedAt: new Date().toISOString(),
  };
  await database().prepare(`
    INSERT INTO docker_commands (id, device_id, container_name, action, status, requested_by, requested_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).bind(command.id, command.deviceId, command.containerName, command.action, command.requestedBy, command.requestedAt).run();
  return command;
}

export async function claimDockerCommand(deviceId: string) {
  await ensureDockerCommandsTable();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const command = await database().prepare(`
    SELECT * FROM docker_commands
    WHERE device_id = ? AND (status = 'pending' OR (status = 'processing' AND claimed_at < ?))
    ORDER BY requested_at ASC
    LIMIT 1
  `).bind(deviceId, staleBefore).first<DockerCommand>();
  if (!command) return null;

  const claimedAt = new Date().toISOString();
  const result = await database().prepare(`
    UPDATE docker_commands
    SET status = 'processing', claimed_at = ?
    WHERE id = ? AND (status = 'pending' OR (status = 'processing' AND claimed_at < ?))
  `).bind(claimedAt, command.id, staleBefore).run();
  return result.meta.changes ? { ...command, status: "processing" as const, claimed_at: claimedAt } : null;
}

export async function completeDockerCommand(id: string, deviceId: string, ok: boolean, result: string) {
  await ensureDockerCommandsTable();
  const completedAt = new Date().toISOString();
  const update = await database().prepare(`
    UPDATE docker_commands
    SET status = ?, completed_at = ?, result = ?
    WHERE id = ? AND device_id = ? AND status = 'processing'
  `).bind(ok ? "succeeded" : "failed", completedAt, result.slice(0, 500), id, deviceId).run();
  return update.meta.changes > 0;
}

export async function getDockerCommand(id: string, requestedBy: string) {
  await ensureDockerCommandsTable();
  return database().prepare(
    "SELECT * FROM docker_commands WHERE id = ? AND requested_by = ?",
  ).bind(id, requestedBy).first<DockerCommand>();
}
