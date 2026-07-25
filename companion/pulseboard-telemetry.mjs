#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { randomFillSync } from "node:crypto";

const HOST = "127.0.0.1";
const PORT = 4319;
const MAX_SPEED_BYTES = 100 * 1024 * 1024;
const SPEED_BUFFER_BYTES = 8 * 1024 * 1024;
const SPEED_CHUNK_BYTES = 64 * 1024;
const IPERF3_DURATION_SECONDS = 8;
const IPERF3_OMIT_SECONDS = 1;
const IPERF3_PARALLEL_STREAMS = 4;
const IPERF3_TIMEOUT_MS = 22_000;
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const CONFIG_PATH = isWindows
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Pulseboard", "relay.json")
  : isMac
    ? path.join(os.homedir(), "Library", "Application Support", "Pulseboard", "relay.json")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Pulseboard", "relay.json");
const ALLOWED_ORIGINS = new Set([
  "https://pulseboard-mac-monitor.rysingsun.chatgpt.site",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const IPERF3_SERVERS = [
  { id: "ca-montreal-leaseweb-0", city: "Montreal", country: "CA", provider: "LeaseWeb", host: "speedtest.mtl2.ca.leaseweb.net", ports: [5201, 5202, 5203, 5204], capacity: "10" },
  { id: "ca-montreal-telus-1", city: "Montreal", country: "CA", provider: "TELUS", host: "speedtest.goco.ca", ports: [9202, 9203, 9204, 9205], capacity: "10" },
  { id: "ca-montreal-goco-2", city: "Montréal", country: "CA", provider: "goco", host: "as21723.goco.ca", ports: [9202, 9203, 9204, 9205], capacity: "—" },
  { id: "ca-ottawa-fortisase-3", city: "Ottawa", country: "CA", provider: "FortiSASE", host: "173.243.131.29", ports: [30001, 30002, 30003, 30004], capacity: "10" },
  { id: "ca-toronto-datapacket-4", city: "Toronto", country: "CA", provider: "DATAPACKET", host: "138.199.57.129", ports: [5201], capacity: "2x10" },
  { id: "ca-toronto-fortisase-5", city: "Toronto", country: "CA", provider: "FortiSASE", host: "96.45.43.6", ports: [30001, 30002, 30003, 30004], capacity: "10" },
  { id: "ca-vancouver-fortisase-6", city: "Vancouver", country: "CA", provider: "FortiSASE", host: "66.35.30.9", ports: [30001, 30002, 30003, 30004], capacity: "10" },
  { id: "ca-victoria-couch-ca-7", city: "Victoria", country: "CA", provider: "couch.ca", host: "speed.couch.ca", ports: [15201, 15202, 15203, 15204], capacity: "1" },
  { id: "ca-woodstock-xplore-8", city: "Woodstock", country: "CA", provider: "Xplore", host: "yyc-speedtest.xplore.ca", ports: [8070, 8071, 8072, 8073], capacity: "—" },
  { id: "us-ashburn-clouvider-9", city: "Ashburn", country: "US", provider: "Clouvider", host: "ash.speedtest.clouvider.net", ports: [5200, 5201, 5202, 5203], capacity: "10" },
  { id: "us-ashburn-datapacket-10", city: "Ashburn", country: "US", provider: "DATAPACKET", host: "37.19.206.20", ports: [5201], capacity: "2x10" },
  { id: "us-ashburn-fortisase-11", city: "Ashburn", country: "US", provider: "FortiSASE", host: "66.35.22.79", ports: [30001, 30002, 30003, 30004], capacity: "10" },
  { id: "us-atlanta-clouvider-12", city: "Atlanta", country: "US", provider: "Clouvider", host: "atl.speedtest.clouvider.net", ports: [5200, 5201, 5202, 5203], capacity: "10" },
  { id: "us-atlanta-datapacket-13", city: "Atlanta", country: "US", provider: "DATAPACKET", host: "185.152.66.67", ports: [5201], capacity: "2x10" },
  { id: "us-boston-datapacket-14", city: "Boston", country: "US", provider: "DATAPACKET", host: "109.61.86.65", ports: [5201], capacity: "2x10" },
  { id: "us-chicago-leaseweb-15", city: "Chicago", country: "US", provider: "LeaseWeb", host: "speedtest.chi11.us.leaseweb.net", ports: [5201, 5202, 5203, 5204], capacity: "10" },
  { id: "us-chicago-datapacket-16", city: "Chicago", country: "US", provider: "DATAPACKET", host: "185.93.1.65", ports: [5201], capacity: "2x10" },
  { id: "us-chicago-clouvider-17", city: "Chicago", country: "US", provider: "Clouvider", host: "chi.speedtest.clouvider.net", ports: [5202, 5203, 5204, 5205], capacity: "10" },
  { id: "us-dallas-leaseweb-18", city: "Dallas", country: "US", provider: "LeaseWeb", host: "speedtest.dal13.us.leaseweb.net", ports: [5201, 5202, 5203, 5204], capacity: "10" },
  { id: "us-dallas-clouvider-19", city: "Dallas", country: "US", provider: "Clouvider", host: "dal.speedtest.clouvider.net", ports: [5200, 5201, 5202, 5203], capacity: "10" },
  { id: "us-dallas-datapacket-20", city: "Dallas", country: "US", provider: "DATAPACKET", host: "89.187.164.1", ports: [5201], capacity: "2x10" },
  { id: "us-dallas-interserver-net-21", city: "Dallas", country: "US", provider: "InterServer.net", host: "dfw.speedtest.is.cc", ports: [5203, 5204, 5205, 5206], capacity: "100" },
  { id: "us-dallas-fortisase-22", city: "Dallas", country: "US", provider: "FortiSASE", host: "66.35.27.207", ports: [30001, 30002, 30003, 30004], capacity: "10" },
  { id: "us-houston-datapacket-23", city: "Houston", country: "US", provider: "DATAPACKET", host: "37.19.216.1", ports: [5201], capacity: "2x10" },
  { id: "us-kansas-city-nocix-24", city: "Kansas City", country: "US", provider: "NOCIX", host: "speedtest.nocix.net", ports: [5201, 5202, 5203, 5204], capacity: "200" },
  { id: "us-los-angeles-clouvider-25", city: "Los Angeles", country: "US", provider: "Clouvider", host: "la.speedtest.clouvider.net", ports: [5200, 5201, 5202, 5203], capacity: "10" },
  { id: "us-los-angeles-leaseweb-26", city: "Los Angeles", country: "US", provider: "LeaseWeb", host: "speedtest.lax12.us.leaseweb.net", ports: [5201, 5202, 5203, 5204], capacity: "10" },
  { id: "us-los-angeles-datapacket-27", city: "Los Angeles", country: "US", provider: "DATAPACKET", host: "185.152.67.2", ports: [5201], capacity: "2x10" },
  { id: "us-miami-leaseweb-28", city: "Miami", country: "US", provider: "LeaseWeb", host: "speedtest.mia11.us.leaseweb.net", ports: [5201, 5202, 5203, 5204], capacity: "10" },
  { id: "us-miami-datapacket-29", city: "Miami", country: "US", provider: "DATAPACKET", host: "195.181.162.195", ports: [5201], capacity: "2x10" },
  { id: "us-miami-fortisase-30", city: "Miami", country: "US", provider: "FortiSASE", host: "23.249.54.234", ports: [30001, 30002, 30003, 30004], capacity: "10" },
  { id: "us-new-york-hostkey-31", city: "New York", country: "US", provider: "HOSTKEY", host: "spd-uswb.hostkey.com", ports: [5201, 5202, 5203, 5204], capacity: "10" },
  { id: "us-new-york-datapacket-32", city: "New York", country: "US", provider: "DATAPACKET", host: "185.59.223.8", ports: [5201], capacity: "2x10" },
  { id: "us-new-york-city-leaseweb-33", city: "New York City", country: "US", provider: "LeaseWeb", host: "speedtest.nyc1.us.leaseweb.net", ports: [5201, 5202, 5203, 5204], capacity: "10" },
  { id: "us-phoenix-leaseweb-34", city: "Phoenix", country: "US", provider: "LeaseWeb", host: "speedtest.phx1.us.leaseweb.net", ports: [5201, 5202, 5203, 5204], capacity: "10" },
  { id: "us-phoenix-clouvider-35", city: "Phoenix", country: "US", provider: "Clouvider", host: "phx.speedtest.clouvider.net", ports: [5200, 5201, 5202, 5203], capacity: "10" },
  { id: "us-plano-fortisase-36", city: "Plano", country: "US", provider: "FortiSASE", host: "209.40.123.215", ports: [30001, 30002, 30003, 30004], capacity: "10" },
  { id: "us-salt-lake-xmission-37", city: "Salt Lake", country: "US", provider: "XMISSION", host: "speedtest.xmission.com", ports: [5201, 5202, 5203, 5204], capacity: "—" },
  { id: "us-san-francisco-leaseweb-38", city: "San Francisco", country: "US", provider: "LeaseWeb", host: "speedtest.sfo12.us.leaseweb.net", ports: [5201, 5202, 5203, 5204], capacity: "10" },
  { id: "us-san-jose-fortisase-39", city: "San Jose", country: "US", provider: "FortiSASE", host: "66.35.20.123", ports: [30001, 30002, 30003, 30004], capacity: "10" },
  { id: "us-san-jose-fortisase-40", city: "San Jose", country: "US", provider: "FortiSASE", host: "148.230.59.38", ports: [30001, 30002, 30003, 30004], capacity: "10" },
  { id: "us-seattle-leaseweb-41", city: "Seattle", country: "US", provider: "LeaseWeb", host: "speedtest.sea11.us.leaseweb.net", ports: [5201, 5202, 5203, 5204], capacity: "10" },
  { id: "us-seattle-datapacket-42", city: "Seattle", country: "US", provider: "DATAPACKET", host: "84.17.41.11", ports: [5201], capacity: "2x10" },
  { id: "us-washington-leaseweb-43", city: "Washington", country: "US", provider: "LeaseWeb", host: "speedtest.wdc2.us.leaseweb.net", ports: [5201, 5202, 5203, 5204], capacity: "10" },
];

function run(command, args = [], timeout = 2500) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout, maxBuffer: 2 * 1024 * 1024 }).trim();
  } catch {
    return "";
  }
}

function powershell(script, timeout = 3500) {
  if (!isWindows) return "";
  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], timeout);
}

function powershellJson(script) {
  const output = powershell(`${script} | ConvertTo-Json -Depth 5 -Compress`);
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function stableDeviceId(platform, name) {
  return `${platform}-${name || os.hostname()}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function usefulSystemText(value, fallback = "") {
  const text = String(value || "").trim();
  return text && !/^default string$/i.test(text) && !/^system product name$/i.test(text) ? text : fallback;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function memoryTextToBytes(value) {
  const kb = Number(String(value || "").replace(/[^\d]/g, ""));
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

function findIperf3() {
  const candidates = [
    process.env.IPERF3_PATH,
    "C:\\Program Files\\iperf3\\iperf3.exe",
    "C:\\Program Files (x86)\\iperf3\\iperf3.exe",
    "/opt/homebrew/bin/iperf3",
    "/usr/local/bin/iperf3",
    "/usr/bin/iperf3",
    "iperf3",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ["--version"], { encoding: "utf8", timeout: 1500, maxBuffer: 128 * 1024 }).split("\n")[0]?.trim();
      if (version) return { path: candidate, version };
    } catch {
      // Try the next common install location.
    }
  }
  return null;
}

function spawnText(command, args, { timeoutMs = IPERF3_TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      child.kill("SIGTERM");
      reject(new Error("The iPerf3 test timed out."));
    }, timeoutMs);
    const abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      reject(new Error("The iPerf3 test was stopped."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `iperf3 exited with code ${code}`));
    });
  });
}

function sysctl(key, fallback = "") {
  if (!isMac) return fallback;
  return run("/usr/sbin/sysctl", ["-n", key]) || fallback;
}

function linuxOsRelease() {
  if (!isLinux) return {};
  try {
    return Object.fromEntries(fs.readFileSync("/etc/os-release", "utf8").split("\n").map((line) => {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) return null;
      return [match[1], match[2].replace(/^"|"$/g, "")];
    }).filter(Boolean));
  } catch {
    return {};
  }
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
let speedBuffer = null;

function readConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return config && typeof config === "object" ? config : {};
  } catch {
    return {};
  }
}

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
  if (isWindows) {
    const total = os.totalmem();
    const free = os.freemem();
    const used = Math.max(0, total - free);
    const freeRatio = total ? free / total : 0;
    const pressure = freeRatio >= 0.25 ? "Low" : freeRatio >= 0.12 ? "Medium" : "High";
    return { totalBytes: total, usedBytes: used, freeBytes: free, wiredBytes: 0, compressedBytes: 0, pressure };
  }

  if (isLinux) {
    const total = os.totalmem();
    const free = os.freemem();
    const values = {};
    try {
      for (const line of fs.readFileSync("/proc/meminfo", "utf8").split("\n")) {
        const match = line.match(/^(\w+):\s+(\d+)/);
        if (match) values[match[1]] = Number(match[2]) * 1024;
      }
    } catch {
      // Fall back to Node's memory view below.
    }
    const available = values.MemAvailable || free;
    const used = Math.max(0, total - available);
    const pressureRatio = total ? available / total : 1;
    const pressure = pressureRatio >= 0.25 ? "Low" : pressureRatio >= 0.12 ? "Medium" : "High";
    return {
      totalBytes: total,
      usedBytes: used,
      freeBytes: available,
      wiredBytes: values.Slab || 0,
      compressedBytes: values.Zswap || values.Zswapped || 0,
      pressure,
    };
  }

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
  if (isWindows) {
    try {
      const stats = fs.statfsSync("C:\\");
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      return { name: "Windows (C:)", totalBytes, usedBytes, freeBytes, percent: totalBytes ? Number((usedBytes / totalBytes * 100).toFixed(1)) : 0 };
    } catch {
      return { name: "Windows (C:)", totalBytes: 0, usedBytes: 0, freeBytes: 0, percent: 0 };
    }
  }

  if (isLinux) {
    try {
      const stats = fs.statfsSync("/");
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      return { name: "Root filesystem", totalBytes, usedBytes, freeBytes, percent: totalBytes ? Number((usedBytes / totalBytes * 100).toFixed(1)) : 0 };
    } catch {
      return { name: "Root filesystem", totalBytes: 0, usedBytes: 0, freeBytes: 0, percent: 0 };
    }
  }

  const lines = run("/bin/df", ["-k", "/System/Volumes/Data"]).split("\n");
  const columns = lines.at(-1)?.trim().split(/\s+/) || [];
  const totalBytes = Number(columns[1] || 0) * 1024;
  const usedBytes = Number(columns[2] || 0) * 1024;
  const freeBytes = Number(columns[3] || 0) * 1024;
  return { name: "Macintosh HD", totalBytes, usedBytes, freeBytes, percent: totalBytes ? Number((usedBytes / totalBytes * 100).toFixed(1)) : 0 };
}

function batteryStats() {
  if (isWindows) {
    return {
      available: false,
      percent: 0,
      state: "Desktop power",
      timeRemainingMinutes: null,
      cycleCount: 0,
      healthPercent: 0,
      condition: "Desktop power",
      powerWatts: null,
    };
  }

  if (isLinux) {
    const base = "/sys/class/power_supply";
    try {
      const battery = fs.readdirSync(base).find((entry) => /^BAT/i.test(entry));
      if (!battery) throw new Error("No battery");
      const batteryPath = path.join(base, battery);
      const capacity = Number(fs.readFileSync(path.join(batteryPath, "capacity"), "utf8").trim() || 0);
      const status = fs.readFileSync(path.join(batteryPath, "status"), "utf8").trim() || "Unknown";
      const healthPercent = Number(run("bash", ["-lc", `cd ${JSON.stringify(batteryPath)} && if [[ -f energy_full_design && -f energy_full ]]; then awk '{if (NR==1) d=$1; else f=$1} END {if (d>0) printf "%.0f", f/d*100; else print 0}' energy_full_design energy_full; elif [[ -f charge_full_design && -f charge_full ]]; then awk '{if (NR==1) d=$1; else f=$1} END {if (d>0) printf "%.0f", f/d*100; else print 0}' charge_full_design charge_full; fi`], 1500) || 0);
      return {
        available: true,
        percent: capacity,
        state: status,
        timeRemainingMinutes: null,
        cycleCount: 0,
        healthPercent: healthPercent || 0,
        condition: healthPercent >= 80 || !healthPercent ? "Normal" : "Service recommended",
        powerWatts: null,
      };
    } catch {
      return {
        available: false,
        percent: 0,
        state: "Desktop power",
        timeRemainingMinutes: null,
        cycleCount: 0,
        healthPercent: 0,
        condition: "No battery sensor",
        powerWatts: null,
      };
    }
  }

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
    available: true,
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
  if (isWindows) {
    return { available: false, status: "Unavailable", speedLimit: 100 };
  }

  if (isLinux) {
    try {
      const zones = fs.readdirSync("/sys/class/thermal").filter((entry) => entry.startsWith("thermal_zone"));
      const temps = zones.map((zone) => {
        try {
          return Number(fs.readFileSync(path.join("/sys/class/thermal", zone, "temp"), "utf8").trim()) / 1000;
        } catch {
          return 0;
        }
      }).filter((value) => value > 0);
      if (!temps.length) return { available: false, status: "Unavailable", speedLimit: 100 };
      const max = Math.max(...temps);
      return { available: true, status: max >= 85 ? "Critical" : max >= 72 ? "Elevated" : "Normal", speedLimit: 100, temperatureCelsius: Number(max.toFixed(1)) };
    } catch {
      return { available: false, status: "Unavailable", speedLimit: 100 };
    }
  }

  const output = run("/usr/bin/pmset", ["-g", "therm"]);
  const warning = /warning level/i.test(output) && !/No thermal warning/i.test(output);
  const speedLimit = Number(output.match(/CPU_Speed_Limit\s*=\s*(\d+)/)?.[1] || 100);
  return { available: true, status: warning ? "Elevated" : "Normal", speedLimit };
}

function networkStats() {
  if (isWindows) {
    const networkEntries = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => (entries || []).map((entry) => ({ name, entry })));
    const active = networkEntries.find(({ entry }) => entry.family === "IPv4" && !entry.internal);
    const interfaceName = active?.name || "Ethernet";
    const address = active?.entry.address || "Unavailable";
    const adapter = powershellJson(`Get-NetAdapterStatistics -Name '${interfaceName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Select-Object ReceivedBytes,SentBytes`);
    const current = { received: Number(adapter?.ReceivedBytes || 0), sent: Number(adapter?.SentBytes || 0) };
    const now = Date.now();
    const elapsed = Math.max(0.25, (now - previousNetworkAt) / 1000);
    const downloadBytesPerSecond = previousNetwork ? Math.max(0, (current.received - previousNetwork.received) / elapsed) : 0;
    const uploadBytesPerSecond = previousNetwork ? Math.max(0, (current.sent - previousNetwork.sent) / elapsed) : 0;
    previousNetwork = current;
    previousNetworkAt = now;
    return { interface: interfaceName, address, downloadBytesPerSecond, uploadBytesPerSecond };
  }

  if (isLinux) {
    let interfaceName = "";
    try {
      const route = fs.readFileSync("/proc/net/route", "utf8").split("\n").slice(1).find((line) => line.split(/\s+/)[1] === "00000000");
      interfaceName = route?.split(/\s+/)[0] || "";
    } catch {
      // Fall back to the first non-internal IPv4 interface below.
    }
    const networkEntries = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => (entries || []).map((entry) => ({ name, entry })));
    const active = networkEntries.find(({ name, entry }) => (!interfaceName || name === interfaceName) && entry.family === "IPv4" && !entry.internal)
      || networkEntries.find(({ entry }) => entry.family === "IPv4" && !entry.internal);
    interfaceName = active?.name || interfaceName || "eth0";
    const address = active?.entry.address || "Unavailable";
    let current = { received: 0, sent: 0 };
    try {
      const line = fs.readFileSync("/proc/net/dev", "utf8").split("\n").find((item) => item.trim().startsWith(`${interfaceName}:`));
      const columns = line?.replace(":", " ").trim().split(/\s+/) || [];
      current = { received: Number(columns[1] || 0), sent: Number(columns[9] || 0) };
    } catch {
      // Keep zero counters.
    }
    const now = Date.now();
    const elapsed = Math.max(0.25, (now - previousNetworkAt) / 1000);
    const downloadBytesPerSecond = previousNetwork ? Math.max(0, (current.received - previousNetwork.received) / elapsed) : 0;
    const uploadBytesPerSecond = previousNetwork ? Math.max(0, (current.sent - previousNetwork.sent) / elapsed) : 0;
    previousNetwork = current;
    previousNetworkAt = now;
    return { interface: interfaceName, address, downloadBytesPerSecond, uploadBytesPerSecond };
  }

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
  if (isWindows) {
    const perf = powershellJson("Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction SilentlyContinue | Where-Object { $_.IDProcess -gt 0 -and $_.Name -notin @('_Total','Idle') } | Select-Object Name,IDProcess,PercentProcessorTime,WorkingSetPrivate");
    const perfRows = Array.isArray(perf) ? perf : perf ? [perf] : [];
    const rows = perfRows.map((item) => ({
      name: String(item?.Name || "Process"),
      pid: String(item?.IDProcess || ""),
      cpu: Number(item?.PercentProcessorTime || 0),
      memoryBytes: Number(item?.WorkingSetPrivate || 0),
    })).filter((item) => item.pid && item.name !== "_Total" && item.name !== "Idle");
    if (!rows.length) {
      const fallbackRows = run("tasklist.exe", ["/fo", "csv", "/nh"], 3500).split("\n").map((line) => line.trim()).filter(Boolean);
      rows.push(...fallbackRows.map((line) => {
        const [name, pid, , , memory] = parseCsvLine(line);
        return { name: String(name || "Process").replace(/\.exe$/i, ""), pid: String(pid || ""), cpu: 0, memoryBytes: memoryTextToBytes(memory) };
      }).filter((item) => item.pid && item.name !== "System Idle Process"));
    }
    const items = rows.sort((a, b) => b.cpu - a.cpu || b.memoryBytes - a.memoryBytes).slice(0, 12).map((item) => {
      return {
        pid: item.pid,
        cpu: Number(item.cpu.toFixed(1)),
        memoryBytes: item.memoryBytes,
        state: item.cpu > 0 ? "R" : "S",
        name: item.name,
        detail: item.cpu > 0 ? "Running" : "Background",
        energy: item.cpu >= 15 ? "High" : item.cpu >= 5 ? "Medium" : "Low",
      };
    });
    return { total: rows.length, running: rows.filter((item) => item.cpu > 0).length, items };
  }

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

function getSpeedBuffer() {
  if (speedBuffer) return speedBuffer;
  speedBuffer = Buffer.allocUnsafe(SPEED_BUFFER_BYTES);
  randomFillSync(speedBuffer);
  return speedBuffer;
}

function windowsDevice() {
  const system = powershellJson("Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,Name");
  const osInfo = powershellJson("Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version");
  const cpu = powershellJson("Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors");
  const name = String(system?.Name || process.env.COMPUTERNAME || os.hostname());
  const manufacturer = usefulSystemText(system?.Manufacturer, "Windows PC");
  const model = usefulSystemText(system?.Model, "Plex client");
  return {
    id: stableDeviceId("windows", name),
    name,
    model: `${manufacturer} ${model}`.trim(),
    chip: String(cpu?.Name || os.cpus()[0]?.model || "Windows CPU"),
    os: `${osInfo?.Caption || "Windows"} ${osInfo?.Version || os.release()}`.trim(),
    platform: "windows",
    role: "Windows 11 Plex client",
    logicalCores: Number(cpu?.NumberOfLogicalProcessors || os.cpus().length),
    performanceCores: Number(cpu?.NumberOfCores || os.cpus().length),
    efficiencyCores: 0,
  };
}

function macDevice() {
  const name = run("/usr/sbin/scutil", ["--get", "ComputerName"]) || os.hostname();
  return {
    id: stableDeviceId("macos", name),
    name,
    model: sysctl("hw.model", "Mac"),
    chip: sysctl("machdep.cpu.brand_string", os.cpus()[0]?.model || "Apple Silicon"),
    os: `${run("/usr/bin/sw_vers", ["-productName"])} ${run("/usr/bin/sw_vers", ["-productVersion"])}`.trim(),
    platform: "macos",
    role: "MacBook",
    logicalCores: Number(sysctl("hw.logicalcpu", String(os.cpus().length))),
    performanceCores: Number(sysctl("hw.perflevel0.physicalcpu", "0")),
    efficiencyCores: Number(sysctl("hw.perflevel1.physicalcpu", "0")),
  };
}

function linuxDevice() {
  const release = linuxOsRelease();
  const name = os.hostname();
  const model = usefulSystemText(run("bash", ["-lc", "cat /sys/devices/virtual/dmi/id/product_name 2>/dev/null || hostnamectl --static 2>/dev/null"], 1500), "Linux PC");
  return {
    id: stableDeviceId("linux", name),
    name,
    model,
    chip: os.cpus()[0]?.model || "Linux CPU",
    os: release.PRETTY_NAME || `${os.type()} ${os.release()}`,
    platform: "linux",
    role: "Linux companion",
    logicalCores: os.cpus().length,
    performanceCores: os.cpus().length,
    efficiencyCores: 0,
  };
}

const staticDevice = isWindows ? windowsDevice() : isMac ? macDevice() : linuxDevice();

function xmlAttribute(text, name) {
  const match = String(text || "").match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? match[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "";
}

function xmlAttrs(text) {
  const attrs = {};
  for (const match of String(text || "").matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) attrs[match[1]] = xmlAttribute(match[0], match[1]);
  return attrs;
}

function plexPreferencesToken() {
  if (isWindows) {
    return powershell("(Get-ItemProperty -Path 'HKCU:\\Software\\Plex, Inc.\\Plex Media Server' -Name PlexOnlineToken -ErrorAction SilentlyContinue).PlexOnlineToken", 1500);
  }
  const candidates = isMac
    ? [path.join(os.homedir(), "Library", "Application Support", "Plex Media Server", "Preferences.xml")]
    : [];
  for (const candidate of candidates) {
    try {
      const token = xmlAttribute(fs.readFileSync(candidate, "utf8"), "PlexOnlineToken");
      if (token) return token;
    } catch {
      // Plex Media Server is not installed locally or has not written preferences yet.
    }
  }
  return "";
}

function plexConfig() {
  const config = readConfig();
  const plex = config.plex || {};
  const token = process.env.PLEX_TOKEN || plex.token || config.plexToken || plexPreferencesToken();
  const url = process.env.PLEX_URL || plex.url || config.plexUrl || "http://127.0.0.1:32400";
  return { url, token, configured: Boolean(token) };
}

async function plexRequest(endpoint, config) {
  if (!config.configured) return null;
  const url = new URL(endpoint, config.url.endsWith("/") ? config.url : `${config.url}/`);
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json, text/xml;q=0.9",
      "X-Plex-Token": config.token,
    },
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`Plex responded ${response.status}`);
  const text = await response.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function plexMediaTitle(item) {
  if (item.grandparentTitle && item.title) return `${item.grandparentTitle} - ${item.title}`;
  if (item.parentTitle && item.title) return `${item.parentTitle} - ${item.title}`;
  return item.title || item.originalTitle || "Untitled";
}

function secondsFromMs(value) {
  const seconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  return Number.isFinite(seconds) ? seconds : 0;
}

function normalizePlexSession(item) {
  const player = item.Player || {};
  const session = item.Session || {};
  const user = item.User || {};
  const media = Array.isArray(item.Media) ? item.Media[0] || {} : item.Media || {};
  const part = Array.isArray(media.Part) ? media.Part[0] || {} : media.Part || {};
  const transcode = item.TranscodeSession || {};
  const duration = secondsFromMs(item.duration);
  const progressSeconds = secondsFromMs(item.viewOffset);
  const progressPercent = duration ? Math.min(100, Math.round(progressSeconds / duration * 100)) : 0;
  const decision = transcode.videoDecision || transcode.audioDecision || part.decision || media.decision || "Direct";
  const quality = [media.videoResolution, media.videoCodec, media.audioCodec].filter(Boolean).join(" / ") || media.container || "Media";
  return {
    state: String(session.state || player.state || "playing").toLowerCase(),
    title: plexMediaTitle(item),
    subtitle: [item.parentTitle, item.year].filter(Boolean).join(" - "),
    type: item.type || "media",
    user: user.title || user.username || "",
    player: player.title || player.product || "Plex player",
    product: player.product || "",
    platform: player.platform || "",
    location: player.local === "1" ? "Local" : player.address || "",
    quality,
    decision: String(decision).replace(/^\w/, (letter) => letter.toUpperCase()),
    transcode: Boolean(transcode.key || transcode.progress || /transcode/i.test(String(decision))),
    progressPercent,
    remainingSeconds: duration ? Math.max(0, duration - progressSeconds) : 0,
    bandwidthKbps: Number(transcode.bandwidth || media.bitrate || 0),
    stream: {
      container: transcode.container || media.container || "",
      video: transcode.videoCodec || media.videoCodec || "",
      audio: transcode.audioCodec || media.audioCodec || "",
      resolution: media.videoResolution || [media.width, media.height].filter(Boolean).join("x"),
      protocol: transcode.protocol || part.protocol || "",
      speed: Number(transcode.speed || 0),
      throttled: transcode.throttled === "1" || transcode.throttled === true,
    },
  };
}

function plexSessionsFromJson(json) {
  const container = json?.MediaContainer || json;
  const metadata = container?.Metadata || container?.Video || container?.Track || [];
  const list = Array.isArray(metadata) ? metadata : [metadata].filter(Boolean);
  return {
    server: {
      name: container?.friendlyName || container?.title1 || "Plex Media Server",
      version: container?.version || "",
      sessions: Number(container?.size || list.length || 0),
      transcodeSessions: Number(container?.transcoderActiveVideoSessions || 0),
    },
    sessions: list.map(normalizePlexSession),
  };
}

function plexSessionsFromXml(xml) {
  const containerOpen = xml.match(/<MediaContainer\b[^>]*>/i)?.[0] || "";
  const blocks = [...xml.matchAll(/<(Video|Track|Photo)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/gi)].map((match) => match[0]);
  const sessions = blocks.map((block) => {
    const mediaTag = block.match(/^<(Video|Track|Photo)\b[^>]*>/i)?.[0] || "";
    const media = xmlAttrs(block.match(/<Media\b[^>]*>/i)?.[0] || "");
    const part = xmlAttrs(block.match(/<Part\b[^>]*>/i)?.[0] || "");
    return normalizePlexSession({
      ...xmlAttrs(mediaTag),
      User: xmlAttrs(block.match(/<User\b[^>]*>/i)?.[0] || ""),
      Player: xmlAttrs(block.match(/<Player\b[^>]*>/i)?.[0] || ""),
      Session: xmlAttrs(block.match(/<Session\b[^>]*>/i)?.[0] || ""),
      TranscodeSession: xmlAttrs(block.match(/<TranscodeSession\b[^>]*>/i)?.[0] || ""),
      Media: { ...media, Part: part },
    });
  });
  return {
    server: {
      name: xmlAttribute(containerOpen, "friendlyName") || xmlAttribute(containerOpen, "title1") || "Plex Media Server",
      version: xmlAttribute(containerOpen, "version"),
      sessions: Number(xmlAttribute(containerOpen, "size") || sessions.length || 0),
      transcodeSessions: Number(xmlAttribute(containerOpen, "transcoderActiveVideoSessions") || 0),
    },
    sessions,
  };
}

async function plexPlaybackTelemetry() {
  const config = plexConfig();
  if (!config.configured) {
    return {
      configured: false,
      reachable: false,
      server: "Not configured",
      sessions: 0,
      transcodeSessions: 0,
      items: [],
      detail: "Add a Plex token to Pulseboard's local companion config to show playback sessions.",
    };
  }
  try {
    const [serverInfo, sessionInfo] = await Promise.all([
      plexRequest("/", config),
      plexRequest("/status/sessions", config),
    ]);
    const server = serverInfo?.json ? plexSessionsFromJson(serverInfo.json).server : plexSessionsFromXml(serverInfo?.text || "").server;
    const playback = sessionInfo?.json ? plexSessionsFromJson(sessionInfo.json) : plexSessionsFromXml(sessionInfo?.text || "");
    const sessions = playback.sessions.slice(0, 4);
    return {
      configured: true,
      reachable: true,
      server: server.name,
      version: server.version,
      sessions: playback.server.sessions,
      transcodeSessions: playback.server.transcodeSessions || sessions.filter((item) => item.transcode).length,
      items: sessions,
      detail: sessions[0]
        ? `${sessions[0].title} is ${sessions[0].state} on ${sessions[0].player}.`
        : "No active Plex playback sessions.",
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      server: "Unavailable",
      sessions: 0,
      transcodeSessions: 0,
      items: [],
      detail: error instanceof Error ? error.message : "Plex server did not respond.",
    };
  }
}

async function plexStats(processes) {
  if (!isWindows) {
    const role = isMac ? "Mac companion" : "Linux companion";
    return { available: false, status: role, processes: 0, cpu: 0, memoryBytes: 0, detail: "Plex playback is shown on the Windows Plex client.", playback: { configured: false, reachable: false, server: role, sessions: 0, transcodeSessions: 0, items: [] } };
  }
  const items = processes.items.filter((item) => /plex/i.test(item.name));
  const cpu = items.reduce((total, item) => total + item.cpu, 0);
  const memoryBytes = items.reduce((total, item) => total + item.memoryBytes, 0);
  const player = items.find((item) => /plex|plexamp/i.test(item.name));
  const playback = await plexPlaybackTelemetry();
  const hasPlayback = playback.reachable && playback.sessions > 0;
  return {
    available: items.length > 0 || playback.reachable,
    status: hasPlayback ? "Streaming" : items.length ? "Detected" : playback.configured ? "Server quiet" : "Not configured",
    processes: items.length,
    cpu: Number(cpu.toFixed(1)),
    memoryBytes,
    detail: hasPlayback ? playback.detail : player ? `${player.name} is active on this Windows client.` : playback.detail,
    playback,
  };
}

function dockerBinary() {
  if (!isWindows) return "";
  const candidates = [
    process.env.DOCKER_PATH,
    "docker.exe",
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Docker", "Docker", "resources", "bin", "docker.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (run(candidate, ["--version"], 1500)) return candidate;
  }
  return "";
}

function dockerLabel(labels, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(labels || "").match(new RegExp(`(?:^|,)${escaped}=([^,]*)`))?.[1] || "";
}

function dockerStats() {
  const empty = { available: false, status: "Unavailable", detail: "Docker health is reported by the Windows Plex companion.", version: "", total: 0, running: 0, healthy: 0, unhealthy: 0, exited: 0, noHealth: 0, items: [] };
  if (!isWindows) return empty;
  const binary = dockerBinary();
  if (!binary) return { ...empty, status: "Not installed", detail: "Docker CLI was not found on this Windows client." };

  const version = run(binary, ["version", "--format", "{{.Server.Version}}"], 2500);
  const output = run(binary, ["ps", "-a", "--format", "{{json .}}"], 4000);
  if (!output) return { ...empty, status: "Daemon offline", detail: "Docker Desktop is installed but the daemon is not reachable.", version };

  const containers = output.split("\n").map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const runningContainers = containers.filter((item) => String(item.State || "").toLowerCase() === "running");
  const healthy = runningContainers.filter((item) => String(item.HealthStatus || "").toLowerCase() === "healthy").length;
  const unhealthy = runningContainers.filter((item) => String(item.HealthStatus || "").toLowerCase() === "unhealthy").length;
  const exited = containers.length - runningContainers.length;
  const noHealth = runningContainers.length - healthy - unhealthy;
  const status = unhealthy ? "Needs attention" : runningContainers.length ? "Running" : containers.length ? "Stopped" : "No containers";
  const detail = unhealthy
    ? `${unhealthy} running container${unhealthy === 1 ? "" : "s"} reported unhealthy.`
    : runningContainers.length
      ? `${runningContainers.length} running container${runningContainers.length === 1 ? "" : "s"}; ${healthy} healthy checks.`
      : containers.length
        ? "Docker is reachable, but no containers are running."
        : "Docker is reachable with no containers.";
  const itemScore = (item) => {
    const state = String(item.State || "").toLowerCase();
    const health = String(item.HealthStatus || "none").toLowerCase();
    if (state === "running" && health === "unhealthy") return 0;
    if (state === "running" && health === "healthy") return 1;
    if (state === "running") return 2;
    return 3;
  };
  const items = [...containers].sort((a, b) => itemScore(a) - itemScore(b) || String(a.Names || "").localeCompare(String(b.Names || ""))).map((item) => ({
    name: String(item.Names || item.ID || "container"),
    image: String(item.Image || ""),
    state: String(item.State || "unknown"),
    health: String(item.HealthStatus || "none"),
    status: String(item.Status || ""),
    project: dockerLabel(item.Labels, "com.docker.compose.project"),
    service: dockerLabel(item.Labels, "com.docker.compose.service"),
    ports: String(item.Ports || ""),
  }));

  return { available: true, status, detail, version, total: containers.length, running: runningContainers.length, healthy, unhealthy, exited, noHealth, items };
}

async function collectTelemetry() {
  const processes = processStats();
  const plex = plexStats(processes);
  const docker = dockerStats();
  return {
    timestamp: new Date().toISOString(),
    device: staticDevice,
    cpu: cpuUsage(),
    memory: vmStats(),
    disk: diskStats(),
    battery: batteryStats(),
    thermal: thermalStats(),
    network: networkStats(),
    system: { loadAverage: isWindows ? [] : os.loadavg().map((value) => Number(value.toFixed(2))) },
    uptimeSeconds: os.uptime(),
    processes,
    plex: await plex,
    docker,
  };
}

function initialTelemetry() {
  const memory = {
    totalBytes: os.totalmem(),
    usedBytes: Math.max(0, os.totalmem() - os.freemem()),
    freeBytes: os.freemem(),
    wiredBytes: 0,
    compressedBytes: 0,
    pressure: "Low",
  };
  return {
    timestamp: new Date().toISOString(),
    device: staticDevice,
    cpu: cpuUsage(),
    memory,
    disk: { name: isWindows ? "Windows (C:)" : isMac ? "Macintosh HD" : "Root filesystem", totalBytes: 0, usedBytes: 0, freeBytes: 0, percent: 0 },
    battery: { available: !isWindows, percent: 0, state: "Starting", timeRemainingMinutes: null, cycleCount: 0, healthPercent: 0, condition: "Checking", powerWatts: null },
    thermal: { available: !isWindows, status: isWindows ? "Unavailable" : "Normal", speedLimit: 100 },
    network: { interface: "Starting", address: "Unavailable", downloadBytesPerSecond: 0, uploadBytesPerSecond: 0 },
    system: { loadAverage: isWindows ? [] : os.loadavg().map((value) => Number(value.toFixed(2))) },
    uptimeSeconds: os.uptime(),
    processes: { total: 0, running: 0, items: [] },
    plex: isWindows
      ? { available: false, status: "Checking", processes: 0, cpu: 0, memoryBytes: 0, detail: "Pulseboard is checking Plex activity.", playback: { configured: false, reachable: false, server: "Checking", sessions: 0, transcodeSessions: 0, items: [] } }
      : { available: false, status: isMac ? "Mac companion" : "Linux companion", processes: 0, cpu: 0, memoryBytes: 0, detail: "Plex playback is shown on the Windows Plex client.", playback: { configured: false, reachable: false, server: isMac ? "Mac companion" : "Linux companion", sessions: 0, transcodeSessions: 0, items: [] } },
    docker: { available: false, status: isWindows ? "Checking" : "Unavailable", detail: isWindows ? "Pulseboard is checking Docker Desktop." : "Docker health is reported by the Windows Plex companion.", version: "", total: 0, running: 0, healthy: 0, unhealthy: 0, exited: 0, noHealth: 0, items: [] },
  };
}

function relayConfig() {
  const config = readConfig();
  if (!config.relayUrl || !config.deviceToken || !config.siwcToken) return null;
  return config;
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

let latestTelemetry = initialTelemetry();
let collecting = false;

async function refreshTelemetry() {
  if (collecting) return;
  collecting = true;
  try {
    latestTelemetry = await collectTelemetry();
    await uploadTelemetry(latestTelemetry);
  } finally {
    collecting = false;
  }
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "7200",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

// Retained for compatibility with older companion binaries; the dashboard no longer exposes speed tests.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handleSpeedTest(request, response, headers, url) {
  if (request.method === "GET" && url.searchParams.get("mode") === "meta") {
    response.writeHead(200, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({
      clientIp: "This browser",
      service: `This ${isWindows ? "Windows" : "Mac"} companion`,
      location: `127.0.0.1:${PORT}`,
      country: "",
    }));
    return true;
  }

  if (request.method === "GET" && url.searchParams.get("mode") === "ping") {
    response.writeHead(200, { "Content-Type": "text/plain", ...headers });
    response.end("pulse");
    return true;
  }

  if (request.method === "GET" && url.searchParams.get("mode") === "download") {
    const requestedSize = Number(url.searchParams.get("size") || 0);
    const size = Math.min(Math.max(Math.round(requestedSize), 64 * 1024), MAX_SPEED_BYTES);
    const source = getSpeedBuffer();
    let sent = 0;
    response.writeHead(200, {
      ...headers,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "identity",
      "Content-Length": String(size),
    });
    const writeChunk = () => {
      while (sent < size) {
        const offset = sent % source.length;
        const chunkSize = Math.min(size - sent, source.length - offset, SPEED_CHUNK_BYTES);
        const shouldContinue = response.write(source.subarray(offset, offset + chunkSize));
        sent += chunkSize;
        if (!shouldContinue) {
          response.once("drain", writeChunk);
          return;
        }
      }
      response.end();
    };
    writeChunk();
    return true;
  }

  if (request.method === "POST" && url.searchParams.get("mode") === "upload") {
    const declaredLength = Number(request.headers["content-length"] || 0);
    if (declaredLength > MAX_SPEED_BYTES) {
      response.writeHead(413, { "Content-Type": "application/json", ...headers });
      response.end(JSON.stringify({ error: "Upload sample is too large" }));
      request.destroy();
      return true;
    }

    let received = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_SPEED_BYTES && !rejected) {
        rejected = true;
        response.writeHead(413, { "Content-Type": "application/json", ...headers });
        response.end(JSON.stringify({ error: "Upload sample is too large" }));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (rejected) return;
      response.writeHead(200, { "Content-Type": "application/json", ...headers });
      response.end(JSON.stringify({ received }));
    });
    request.on("error", () => {
      if (response.headersSent) return;
      response.writeHead(500, { "Content-Type": "application/json", ...headers });
      response.end(JSON.stringify({ error: "Upload failed" }));
    });
    return true;
  }

  return false;
}

function pingStats(host) {
  const output = isWindows
    ? run("ping.exe", ["-n", "4", "-w", "1000", host])
    : run("/sbin/ping", ["-c", "4", "-n", "-W", "1000", host]);
  const samples = [...output.matchAll(/time=([\d.]+)\s*ms/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  if (!samples.length) return { ping: 0, jitter: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const deltas = sorted.slice(1).map((value, index) => Math.abs(value - sorted[index]));
  const averageDelta = deltas.length ? deltas.reduce((total, value) => total + value, 0) / deltas.length : 0;
  return { ping: sorted[Math.floor(sorted.length / 2)], jitter: averageDelta };
}

function iperfMbps(report, reverse) {
  const end = report?.end || {};
  const sum = reverse ? (end.sum_received || end.sum_sent) : (end.sum_sent || end.sum_received);
  const bitsPerSecond = Number(sum?.bits_per_second || 0);
  return Number.isFinite(bitsPerSecond) ? bitsPerSecond / 1_000_000 : 0;
}

async function runIperfDirection(binary, server, reverse, signal) {
  const errors = [];
  for (const port of server.ports) {
    const args = [
      "-J",
      "-c", server.host,
      "-p", String(port),
      "-t", String(IPERF3_DURATION_SECONDS),
      "-O", String(IPERF3_OMIT_SECONDS),
      "-P", String(IPERF3_PARALLEL_STREAMS),
      "--connect-timeout", "4000",
    ];
    if (reverse) args.push("-R");
    try {
      const { stdout } = await spawnText(binary, args, { signal });
      const report = JSON.parse(stdout);
      const mbps = iperfMbps(report, reverse);
      if (mbps > 0) return { mbps, port };
      errors.push(`port ${port}: no throughput reported`);
    } catch (error) {
      errors.push(`port ${port}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  throw new Error(errors.at(-1) || "The selected iPerf3 server did not respond.");
}

function readJsonBody(request, maxBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let raw = "";
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      raw += chunk.toString();
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Request body must be JSON."));
      }
    });
    request.on("error", reject);
  });
}

// Retained for compatibility with older companion binaries; the dashboard no longer exposes speed tests.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleIperf3(request, response, headers, url) {
  const binary = findIperf3();
  if (request.method === "GET" && url.pathname === "/iperf3/servers") {
    response.writeHead(binary ? 200 : 503, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({
      available: Boolean(binary),
      version: binary?.version || "",
      servers: IPERF3_SERVERS,
      error: binary ? "" : "iperf3 is not installed. Install it with Homebrew (`brew install iperf3`) and restart Pulseboard Companion.",
    }));
    return true;
  }

  if (request.method !== "POST" || url.pathname !== "/iperf3/test") return false;
  if (!binary) {
    response.writeHead(503, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ error: "iperf3 is not installed. Install it with Homebrew (`brew install iperf3`) and restart Pulseboard Companion." }));
    return true;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    response.writeHead(400, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Invalid request." }));
    return true;
  }

  const server = IPERF3_SERVERS.find((candidate) => candidate.id === body.serverId);
  if (!server) {
    response.writeHead(400, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ error: "Choose one of the allowlisted North America iPerf3 servers." }));
    return true;
  }

  const abort = new AbortController();
  let finished = false;
  response.on("close", () => {
    if (!finished) abort.abort();
  });

  try {
    const latency = pingStats(server.host);
    const download = await runIperfDirection(binary.path, server, true, abort.signal);
    const upload = await runIperfDirection(binary.path, server, false, abort.signal);
    const result = {
      ping: Number(latency.ping.toFixed(1)),
      jitter: Number(latency.jitter.toFixed(1)),
      download: Number(download.mbps.toFixed(1)),
      upload: Number(upload.mbps.toFixed(1)),
      loadedLatency: Number(latency.ping.toFixed(1)),
      bufferbloat: "n/a",
    };
    finished = true;
    response.writeHead(200, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ result, server, port: download.port === upload.port ? download.port : `${download.port}/${upload.port}` }));
  } catch (error) {
    finished = true;
    response.writeHead(502, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "The iPerf3 test failed." }));
  }
  return true;
}

const server = http.createServer((request, response) => {
  const origin = request.headers.origin || "";
  const headers = corsHeaders(origin);
  const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (request.method === "OPTIONS") {
    response.writeHead(ALLOWED_ORIGINS.has(origin) ? 204 : 403, headers);
    response.end();
    return;
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    response.writeHead(403, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ error: "Origin not allowed" }));
    return;
  }
  if (request.method !== "GET" || url.pathname !== "/telemetry") {
    response.writeHead(404, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify({ error: "Not found" }));
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
  console.log(`Reporting ${staticDevice.role}: ${staticDevice.name}`);
});

const relayTimer = setInterval(() => void refreshTelemetry(), 5000);
void refreshTelemetry();

process.on("SIGINT", () => { clearInterval(relayTimer); server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { clearInterval(relayTimer); server.close(() => process.exit(0)); });
