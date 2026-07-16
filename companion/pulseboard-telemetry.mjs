#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = 4319;
const CONFIG_PATH = path.join(os.homedir(), "Library", "Application Support", "Pulseboard", "relay.json");
const ALLOWED_ORIGINS = new Set([
  "https://pulseboard-mac-monitor.rysingsun.chatgpt.site",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function run(command, args = []) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 2500, maxBuffer: 2 * 1024 * 1024 }).trim();
  } catch {
    return "";
  }
}

function sysctl(key, fallback = "") {
  return run("/usr/sbin/sysctl", ["-n", key]) || fallback;
}

function cpuSnapshot() {
  return os.cpus().reduce((sum, cpu) => {
    const total = Object.values(cpu.times).reduce((value, tick) => value + tick, 0);
    return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
  }, { idle: 0, total: 0 });
}

let previousCpu = cpuSnapshot();
let previousCpuUsage = 0;
let previousNetwork = null;
let previousNetworkAt = Date.now();
let relayState = "starting";

function cpuUsage() {
  const current = cpuSnapshot();
  const idle = current.idle - previousCpu.idle;
  const total = current.total - previousCpu.total;
  previousCpu = current;
  const usage = total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : previousCpuUsage;
  const result = { usage: Number(usage.toFixed(1)), previous: previousCpuUsage };
  previousCpuUsage = result.usage;
  return result;
}

function vmStats() {
  const output = run("/usr/bin/vm_stat");
  const pageSize = Number(output.match(/page size of (\d+) bytes/)?.[1] || 16384);
  const values = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([^:]+):\s+([\d.]+)/);
    if (match) values[match[1]] = Number(match[2].replace(".", "")) * pageSize;
  }
  const free = (values["Pages free"] || 0) + (values["Pages speculative"] || 0);
  const wired = values["Pages wired down"] || 0;
  const compressed = values["Pages occupied by compressor"] || 0;
  const total = os.totalmem();
  const used = Math.max(0, total - free);
  const pressureOutput = run("/usr/bin/memory_pressure", ["-Q"]);
  const freePercent = Number(pressureOutput.match(/free percentage:\s*(\d+)%/)?.[1] || 0);
  const pressure = freePercent >= 30 ? "Low" : freePercent >= 15 ? "Medium" : "High";
  return { totalBytes: total, usedBytes: used, freeBytes: free, wiredBytes: wired, compressedBytes: compressed, pressure };
}

function diskStats() {
  const lines = run("/bin/df", ["-k", "/System/Volumes/Data"]).split("\n");
  const columns = lines.at(-1)?.trim().split(/\s+/) || [];
  const totalBytes = Number(columns[1] || 0) * 1024;
  const usedBytes = Number(columns[2] || 0) * 1024;
  const freeBytes = Number(columns[3] || 0) * 1024;
  return { name: "Macintosh HD", totalBytes, usedBytes, freeBytes, percent: totalBytes ? Number((usedBytes / totalBytes * 100).toFixed(1)) : 0 };
}

function batteryStats() {
  const pmset = run("/usr/bin/pmset", ["-g", "batt"]);
  const ioreg = run("/usr/sbin/ioreg", ["-rc", "AppleSmartBattery"]);
  const percent = Number(pmset.match(/(\d+)%/)?.[1] || 0);
  const state = pmset.match(/;\s*([^;]+);/)?.[1]?.trim() || "Unknown";
  const timeText = pmset.match(/(\d+):(\d+) remaining/) || pmset.match(/(\d+):(\d+) to full/);
  const timeRemainingMinutes = timeText ? Number(timeText[1]) * 60 + Number(timeText[2]) : null;
  const cycleCount = Number(ioreg.match(/"CycleCount"\s*=\s*(\d+)/)?.[1] || 0);
  const design = Number(ioreg.match(/"DesignCapacity"\s*=\s*(\d+)/)?.[1] || 0);
  const full = Number(ioreg.match(/"FullChargeCapacity"\s*=\s*(\d+)/)?.[1] || design);
  const healthPercent = design ? Math.min(100, Math.round(full / design * 100)) : 100;
  const systemLoad = Number(ioreg.match(/"SystemLoad"\s*=\s*(\d+)/)?.[1] || 0);
  return {
    percent,
    state: state[0]?.toUpperCase() + state.slice(1),
    timeRemainingMinutes,
    cycleCount,
    healthPercent,
    condition: healthPercent >= 80 ? "Normal" : "Service recommended",
    powerWatts: systemLoad ? Number((systemLoad / 1000).toFixed(1)) : null,
  };
}

function thermalStats() {
  const output = run("/usr/bin/pmset", ["-g", "therm"]);
  const warning = /warning level/i.test(output) && !/No thermal warning/i.test(output);
  const speedLimit = Number(output.match(/CPU_Speed_Limit\s*=\s*(\d+)/)?.[1] || 100);
  return { status: warning ? "Elevated" : "Normal", speedLimit };
}

function networkStats() {
  const route = run("/sbin/route", ["-n", "get", "default"]);
  const interfaceName = route.match(/interface:\s*(\S+)/)?.[1] || "en0";
  const address = (os.networkInterfaces()[interfaceName] || []).find((entry) => entry.family === "IPv4" && !entry.internal)?.address || "Unavailable";
  const lines = run("/usr/sbin/netstat", ["-ibn"]).split("\n");
  const linkLine = lines.find((line) => line.startsWith(`${interfaceName} `) && line.includes("<Link#"));
  const columns = linkLine?.trim().split(/\s+/) || [];
  const current = { received: Number(columns[6] || 0), sent: Number(columns[9] || 0) };
  const now = Date.now();
  const elapsed = Math.max(0.25, (now - previousNetworkAt) / 1000);
  const downloadBytesPerSecond = previousNetwork ? Math.max(0, (current.received - previousNetwork.received) / elapsed) : 0;
  const uploadBytesPerSecond = previousNetwork ? Math.max(0, (current.sent - previousNetwork.sent) / elapsed) : 0;
  previousNetwork = current;
  previousNetworkAt = now;
  return { interface: interfaceName, address, downloadBytesPerSecond, uploadBytesPerSecond };
}

function processStats() {
  const output = run("/bin/ps", ["-axo", "pid=,pcpu=,rss=,state=,comm="]);
  const rows = output.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) return null;
    const name = path.basename(match[5]).replace(/\.app$/, "");
    return { pid: match[1], cpu: Number(match[2]), memoryBytes: Number(match[3]) * 1024, state: match[4], name };
  }).filter(Boolean);
  const items = [...rows].sort((a, b) => b.cpu - a.cpu).slice(0, 12).map((item) => ({
    ...item,
    detail: item.state.startsWith("R") ? "Running" : "Background",
    energy: item.cpu >= 15 ? "High" : item.cpu >= 5 ? "Medium" : "Low",
  }));
  return { total: rows.length, running: rows.filter((row) => row.state.startsWith("R")).length, items };
}

const staticDevice = {
  name: run("/usr/sbin/scutil", ["--get", "ComputerName"]) || os.hostname(),
  model: sysctl("hw.model", "Mac"),
  chip: sysctl("machdep.cpu.brand_string", os.cpus()[0]?.model || "Apple Silicon"),
  os: `${run("/usr/bin/sw_vers", ["-productName"])} ${run("/usr/bin/sw_vers", ["-productVersion"])}`.trim(),
  logicalCores: Number(sysctl("hw.logicalcpu", String(os.cpus().length))),
  performanceCores: Number(sysctl("hw.perflevel0.physicalcpu", "0")),
  efficiencyCores: Number(sysctl("hw.perflevel1.physicalcpu", "0")),
};

function collectTelemetry() {
  return {
    timestamp: new Date().toISOString(),
    device: staticDevice,
    cpu: cpuUsage(),
    memory: vmStats(),
    disk: diskStats(),
    battery: batteryStats(),
    thermal: thermalStats(),
    network: networkStats(),
    uptimeSeconds: os.uptime(),
    processes: processStats(),
  };
}

function relayConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!config.relayUrl || !config.deviceToken || !config.siwcToken) return null;
    return config;
  } catch {
    return null;
  }
}

async function uploadTelemetry(snapshot) {
  const config = relayConfig();
  if (!config) {
    relayState = "not-configured";
    return;
  }
  try {
    const response = await fetch(`${config.relayUrl}/api/telemetry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.deviceToken}`,
        "OAI-Sites-Authorization": `Bearer ${config.siwcToken}`,
      },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(8000),
    });
    relayState = response.ok ? "connected" : `error-${response.status}`;
  } catch {
    relayState = "unreachable";
  }
}

let latestTelemetry = collectTelemetry();
let collecting = false;

async function refreshTelemetry() {
  if (collecting) return;
  collecting = true;
  try {
    latestTelemetry = collectTelemetry();
    await uploadTelemetry(latestTelemetry);
  } finally {
    collecting = false;
  }
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "7200",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

const server = http.createServer((request, response) => {
  const origin = request.headers.origin || "";
  const headers = corsHeaders(origin);
  if (request.method === "OPTIONS") {
    response.writeHead(ALLOWED_ORIGINS.has(origin) ? 204 : 403, headers);
    response.end();
    return;
  }
  if (request.method !== "GET" || request.url !== "/telemetry") {
    response.writeHead(404, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    response.writeHead(403, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ error: "Origin not allowed" }));
    return;
  }
  try {
    response.writeHead(200, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ ...latestTelemetry, relay: { state: relayState } }));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Telemetry failed" }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Pulseboard Companion is running at http://${HOST}:${PORT}`);
  console.log("Live telemetry is available locally and through the encrypted relay.");
});

const relayTimer = setInterval(() => void refreshTelemetry(), 5000);
void refreshTelemetry();

process.on("SIGINT", () => { clearInterval(relayTimer); server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { clearInterval(relayTimer); server.close(() => process.exit(0)); });
