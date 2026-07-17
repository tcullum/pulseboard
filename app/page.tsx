"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ProcessItem = {
  name: string;
  detail: string;
  pid: string;
  cpu: number;
  memoryBytes: number;
  energy: "Low" | "Medium" | "High";
};

type Telemetry = {
  timestamp: string;
  device: { name: string; model: string; chip: string; os: string; logicalCores: number; performanceCores: number; efficiencyCores: number };
  cpu: { usage: number; previous: number };
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; wiredBytes: number; compressedBytes: number; pressure: "Low" | "Medium" | "High" };
  disk: { name: string; totalBytes: number; usedBytes: number; freeBytes: number; percent: number };
  battery: { percent: number; state: string; timeRemainingMinutes: number | null; cycleCount: number; healthPercent: number; condition: string; powerWatts: number | null };
  thermal: { status: string; speedLimit: number };
  network: { interface: string; address: string; downloadBytesPerSecond: number; uploadBytesPerSecond: number };
  uptimeSeconds: number;
  processes: { total: number; running: number; items: ProcessItem[] };
};

type SpeedStage = "idle" | "ping" | "download" | "upload" | "complete" | "error";
type SpeedResult = { ping: number; jitter: number; download: number; upload: number; loadedLatency: number; bufferbloat: string };
type SpeedMeta = { clientIp: string; service: string; location: string; country?: string };
type SpeedHistoryItem = SpeedResult & { timestamp: string };
type SpeedUnit = "Mbps" | "MB/s";
type SpeedServerChoice = "auto" | "mac" | "custom";

const COMPANION_URL = "http://127.0.0.1:4319/telemetry";
const LOCAL_SPEED_TEST_URL = "http://127.0.0.1:4319/speed-test";
const SPEED_PHASE_MS = 12_000;
const SPEED_RAMP_UP_MS = 2_000;
// If the site is served over HTTP/2, these requests may multiplex over one TCP connection.
// For strict multi-connection testing, terminate this route with HTTP/1.1 at the proxy.
const SPEED_STREAMS = 6;
const SPEED_WINDOW_MS = 750;
const SPEED_SCALE_MAX_MBPS = 3000;
const SPEED_ARC_START = -126;
const SPEED_ARC_SWEEP = 252;
const palette = ["#8799ff", "#f3a95f", "#5ee6a8", "#df74e8", "#5dbedf", "#55d779"];

function Mark({ children }: { children: React.ReactNode }) {
  return <span className="mark" aria-hidden="true">{children}</span>;
}

function gb(bytes = 0, digits = 1) {
  return (bytes / 1024 ** 3).toFixed(digits);
}

function rate(bytes = 0) {
  if (bytes >= 1024 ** 2) return { value: (bytes / 1024 ** 2).toFixed(1), unit: "MB/s" };
  return { value: Math.round(bytes / 1024).toLocaleString(), unit: "KB/s" };
}

function uptime(seconds = 0) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function remaining(minutes: number | null) {
  if (minutes === null) return "Calculating time remaining";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours}h ${mins}m remaining` : `${mins} min remaining`;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function jitter(values: number[]) {
  if (values.length < 2) return 0;
  return average(values.slice(1).map((value, index) => Math.abs(value - values[index])));
}

function trimmedMean(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * 0.1);
  const stable = sorted.slice(trim, sorted.length - trim || sorted.length);
  return average(stable.length ? stable : sorted);
}

function bufferbloatGrade(delta: number) {
  if (delta < 30) return "A";
  if (delta < 100) return "B";
  if (delta < 250) return "C";
  return "D";
}

function speedRatio(mbps = 0) {
  return Math.min(Math.max(mbps / SPEED_SCALE_MAX_MBPS, 0), 1);
}

function gaugeAngle(mbps = 0) {
  return SPEED_ARC_START + speedRatio(mbps) * SPEED_ARC_SWEEP;
}

function formatSpeed(mbps = 0, unit: SpeedUnit) {
  return unit === "MB/s" ? (mbps / 8).toFixed(1) : mbps.toFixed(1);
}

function formatTick(mbps: number, unit: SpeedUnit) {
  if (unit === "MB/s") return `${Math.round(mbps / 8)}`;
  if (mbps >= 1000) return `${mbps / 1000}g`;
  return `${mbps}`;
}

function tickPosition(mbps: number) {
  const angle = (gaugeAngle(mbps) - 90) * Math.PI / 180;
  const radius = 38;
  return {
    left: `${50 + Math.cos(angle) * radius}%`,
    top: `${50 + Math.sin(angle) * radius}%`,
  };
}

function normalizeSpeedBase(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function speedTestUrl(baseUrl: string, mode: string, params: Record<string, string | number> = {}) {
  const search = new URLSearchParams({ mode });
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  search.set("nonce", `${Date.now()}-${Math.random()}`);
  return `${baseUrl}?${search.toString()}`;
}

function speedQuality(download: number) {
  if (download >= 200) return "Excellent";
  if (download >= 75) return "Very good";
  if (download >= 25) return "Good";
  return "Limited";
}

export default function Home() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [sort, setSort] = useState<"cpu" | "memory">("cpu");
  const [range, setRange] = useState<"1H" | "6H" | "24H">("1H");
  const [paused, setPaused] = useState(false);
  const [cpuHistory, setCpuHistory] = useState<number[]>(Array(36).fill(0));
  const [activeView, setActiveView] = useState("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(2500);
  const [transport, setTransport] = useState<"direct" | "relay" | null>(null);
  const [relayAgeSeconds, setRelayAgeSeconds] = useState(0);
  const [theme, setTheme] = useState<"night" | "day">("night");
  const fetchInFlight = useRef<Promise<void> | null>(null);
  const [speedStage, setSpeedStage] = useState<SpeedStage>("idle");
  const [speedResult, setSpeedResult] = useState<SpeedResult | null>(null);
  const [speedPartial, setSpeedPartial] = useState<Partial<SpeedResult>>({});
  const [speedMeta, setSpeedMeta] = useState<SpeedMeta | null>(null);
  const [speedHistory, setSpeedHistory] = useState<SpeedHistoryItem[]>([]);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [speedProgress, setSpeedProgress] = useState(0);
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>("Mbps");
  const [speedServer, setSpeedServer] = useState<SpeedServerChoice>("auto");
  const [customSpeedServer, setCustomSpeedServer] = useState("");
  const [speedError, setSpeedError] = useState("");
  const speedTestController = useRef<AbortController | null>(null);
  const speedUploadRequests = useRef<XMLHttpRequest[]>([]);

  const navigateTo = useCallback((target: string) => {
    setActiveView(target);
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const fetchTelemetry = useCallback(() => {
    if (fetchInFlight.current) return fetchInFlight.current;

    const request = (async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1000);
      try {
        const response = await fetch(COMPANION_URL, { cache: "no-store", mode: "cors", signal: controller.signal });
        if (!response.ok) throw new Error("Companion unavailable");
        const next = await response.json() as Telemetry;
        setTelemetry(next);
        setCpuHistory((history) => [...history.slice(1), next.cpu.usage]);
        setStatus("live");
        setTransport("direct");
        setRelayAgeSeconds(0);
      } catch {
        try {
          const relayResponse = await fetch("/api/telemetry", { cache: "no-store", credentials: "same-origin" });
          if (!relayResponse.ok) throw new Error("Relay unavailable");
          const relay = await relayResponse.json() as { telemetry: Telemetry; ageSeconds: number; stale: boolean };
          setTelemetry(relay.telemetry);
          setCpuHistory((history) => [...history.slice(1), relay.telemetry.cpu.usage]);
          setStatus("live");
          setTransport("relay");
          setRelayAgeSeconds(relay.ageSeconds);
        } catch {
          setStatus("offline");
          setTransport(null);
        }
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    fetchInFlight.current = request;
    void request.finally(() => {
      if (fetchInFlight.current === request) fetchInFlight.current = null;
    });
    return request;
  }, []);

  const runSpeedTest = useCallback(async () => {
    if (speedTestController.current) {
      speedTestController.current.abort();
      speedUploadRequests.current.forEach((request) => request.abort());
      return;
    }
    if (speedServer === "custom" && !customSpeedServer.trim()) {
      setSpeedError("Enter a compatible speed-test endpoint URL first.");
      return;
    }

    const controller = new AbortController();
    speedTestController.current = controller;
    setSpeedResult(null);
    setSpeedPartial({});
    setCurrentSpeed(0);
    setSpeedProgress(0);
    setSpeedError("");
    const speedBaseUrl = speedServer === "mac"
      ? LOCAL_SPEED_TEST_URL
      : speedServer === "custom" && customSpeedServer.trim()
        ? normalizeSpeedBase(customSpeedServer)
        : "/api/speed-test";
    const serverName = speedServer === "mac" ? "This Mac companion" : speedServer === "custom" ? "Custom server" : "Pulseboard edge";
    setSpeedMeta({
      clientIp: speedServer === "mac" ? "This browser" : speedServer === "custom" ? "This device" : "This device",
      service: serverName,
      location: speedServer === "mac" ? "127.0.0.1 local companion" : speedServer === "custom" ? normalizeSpeedBase(customSpeedServer) : "Nearest service edge",
    });

    try {
      fetch(speedTestUrl(speedBaseUrl, "meta"), {
        cache: "no-store",
        credentials: speedBaseUrl.startsWith("/") ? "same-origin" : "omit",
        signal: controller.signal,
      })
        .then((response) => response.ok ? response.json() : null)
        .then((meta: SpeedMeta | null) => { if (meta) setSpeedMeta(meta); })
        .catch(() => undefined);

      setSpeedStage("ping");
      const pingSamples: number[] = [];
      const pingOnce = async () => {
        const started = performance.now();
        const response = await fetch(speedTestUrl(speedBaseUrl, "ping"), {
          cache: "no-store",
          credentials: speedBaseUrl.startsWith("/") ? "same-origin" : "omit",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${serverName} did not respond.`);
        await response.text();
        return performance.now() - started;
      };

      for (let index = 0; index < 10; index += 1) {
        pingSamples.push(await pingOnce());
      }
      const stablePingSamples = pingSamples.slice(1);
      const ping = Math.min(...stablePingSamples);
      const jitterValue = jitter(stablePingSamples);
      setSpeedPartial({ ping, jitter: jitterValue });

      const loadedSamples: number[] = [];
      const startLoadedLatency = () => {
        let stopped = false;
        const loop = async () => {
          while (!stopped && !controller.signal.aborted) {
            try {
              loadedSamples.push(await pingOnce());
            } catch {
              if (!controller.signal.aborted) loadedSamples.push(ping + 500);
            }
            await new Promise((resolve) => window.setTimeout(resolve, 500));
          }
        };
        void loop();
        return () => { stopped = true; };
      };

      const runTransferPhase = async (stage: "download" | "upload", worker: (stream: number, until: number, onBytes: (bytes: number) => void) => Promise<void>) => {
        setSpeedStage(stage);
        setCurrentSpeed(0);
        setSpeedProgress(0);
        const phaseStarted = performance.now();
        const phaseEnds = phaseStarted + SPEED_PHASE_MS;
        const byteEvents: Array<{ time: number; bytes: number }> = [];
        const stableSamples: number[] = [];
        const stopLoadedLatency = startLoadedLatency();

        const sample = () => {
          const now = performance.now();
          const windowStart = now - SPEED_WINDOW_MS;
          while (byteEvents.length && byteEvents[0].time < windowStart - 250) byteEvents.shift();
          const windowBytes = byteEvents.filter((event) => event.time >= windowStart).reduce((total, event) => total + event.bytes, 0);
          const windowSeconds = Math.max(Math.min((now - Math.max(windowStart, phaseStarted)) / 1000, SPEED_WINDOW_MS / 1000), 0.1);
          const mbps = windowBytes * 8 / windowSeconds / 1_000_000;
          const progress = Math.min((now - phaseStarted) / SPEED_PHASE_MS, 1);
          setCurrentSpeed(mbps);
          setSpeedProgress(progress);
          if (now - phaseStarted >= SPEED_RAMP_UP_MS && mbps > 0) stableSamples.push(mbps);
        };

        const sampler = window.setInterval(sample, 250);
        const onBytes = (bytes: number) => byteEvents.push({ time: performance.now(), bytes });
        try {
          await Promise.all(Array.from({ length: SPEED_STREAMS }, (_, stream) => worker(stream, phaseEnds, onBytes)));
          sample();
        } finally {
          window.clearInterval(sampler);
          stopLoadedLatency();
        }

        return trimmedMean(stableSamples);
      };

      setSpeedStage("download");
      const download = await runTransferPhase("download", async (stream, until, onBytes) => {
        let size = 4 * 1024 * 1024;
        while (performance.now() < until && !controller.signal.aborted) {
          const requestStarted = performance.now();
          const response = await fetch(speedTestUrl(speedBaseUrl, "download", { size, stream }), {
            cache: "no-store",
            credentials: speedBaseUrl.startsWith("/") ? "same-origin" : "omit",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`The download test to ${serverName} could not finish.`);

          if (!response.body) {
            onBytes((await response.arrayBuffer()).byteLength);
          } else {
            const reader = response.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              onBytes(value.byteLength);
            }
          }

          if (performance.now() - requestStarted < 1_700) size = Math.min(size * 2, 32 * 1024 * 1024);
        }
      });
      setSpeedPartial({ ping, jitter: jitterValue, download });

      const payloadCache = new Map<number, Uint8Array>();
      const payloadFor = (size: number) => {
        const cached = payloadCache.get(size);
        if (cached) return cached;
        const payload = new Uint8Array(size);
        for (let offset = 0; offset < payload.length; offset += 65_536) {
          crypto.getRandomValues(payload.subarray(offset, Math.min(offset + 65_536, payload.length)));
        }
        payloadCache.set(size, payload);
        return payload;
      };

      const upload = await runTransferPhase("upload", async (stream, until, onBytes) => {
        let size = 4 * 1024 * 1024;
        while (performance.now() < until && !controller.signal.aborted) {
          const payload = payloadFor(size);
          const requestStarted = performance.now();
          await new Promise<void>((resolve, reject) => {
            const request = new XMLHttpRequest();
            let counted = 0;
            const abort = () => request.abort();
            speedUploadRequests.current.push(request);
            controller.signal.addEventListener("abort", abort, { once: true });
            request.open("POST", speedTestUrl(speedBaseUrl, "upload", { stream }), true);
            request.withCredentials = false;
            request.setRequestHeader("Content-Type", "application/octet-stream");
            request.upload.onprogress = (event) => {
              const next = event.loaded || 0;
              const delta = Math.max(next - counted, 0);
              counted = next;
              if (delta) onBytes(delta);
            };
            request.onload = () => {
              if (counted < payload.byteLength) onBytes(payload.byteLength - counted);
              controller.signal.removeEventListener("abort", abort);
              speedUploadRequests.current = speedUploadRequests.current.filter((item) => item !== request);
              if (request.status >= 200 && request.status < 300) resolve();
              else reject(new Error(request.status === 413 ? "The upload sample was rejected by the server size limit." : `The upload test to ${serverName} could not finish.`));
            };
            request.onerror = () => {
              controller.signal.removeEventListener("abort", abort);
              speedUploadRequests.current = speedUploadRequests.current.filter((item) => item !== request);
              reject(new Error("The upload endpoint could not be reached."));
            };
            request.onabort = () => {
              controller.signal.removeEventListener("abort", abort);
              speedUploadRequests.current = speedUploadRequests.current.filter((item) => item !== request);
              reject(new DOMException("The speed test was stopped.", "AbortError"));
            };
            request.send(payload);
          });
          if (performance.now() - requestStarted < 1_700) size = Math.min(size * 2, 32 * 1024 * 1024);
        }
      });

      const loadedLatency = median(loadedSamples) || ping;
      const loadedDelta = Math.max(loadedLatency - ping, 0);
      const result = { ping, jitter: jitterValue, download, upload, loadedLatency, bufferbloat: bufferbloatGrade(loadedDelta) };

      setSpeedResult(result);
      setSpeedPartial(result);
      setCurrentSpeed(download);
      setSpeedProgress(1);
      setSpeedStage("complete");
      setSpeedHistory((history) => {
        const next = [{ ...result, timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }, ...history].slice(0, 20);
        window.localStorage.setItem("pulseboard-speed-history", JSON.stringify(next));
        return next;
      });
    } catch (error) {
      speedUploadRequests.current.forEach((request) => request.abort());
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        setSpeedStage("idle");
        setSpeedError("Test stopped. You can run it again whenever you’re ready.");
      } else {
        setSpeedStage("error");
        setSpeedError(error instanceof Error ? error.message : "The speed test could not finish.");
      }
    } finally {
      speedUploadRequests.current = [];
      if (speedTestController.current === controller) speedTestController.current = null;
    }
  }, [customSpeedServer, speedServer]);

  useEffect(() => {
    void fetchTelemetry();
    if (paused) return;
    const id = window.setInterval(() => void fetchTelemetry(), refreshInterval);
    return () => window.clearInterval(id);
  }, [fetchTelemetry, paused, refreshInterval]);

  useEffect(() => {
    const recoverMissingStyles = () => {
      const stylesReady = window.getComputedStyle(document.documentElement).getPropertyValue("--pulseboard-ready").trim() === "1";
      if (stylesReady) return false;

      const lastRecovery = Number(window.sessionStorage.getItem("pulseboard-style-recovery") || 0);
      if (Date.now() - lastRecovery < 30_000) return false;

      window.sessionStorage.setItem("pulseboard-style-recovery", String(Date.now()));
      const recoveryUrl = new URL(window.location.href);
      recoveryUrl.searchParams.set("pb-recover", String(Date.now()));
      window.location.replace(recoveryUrl.toString());
      return true;
    };

    const resume = () => {
      if (document.visibilityState !== "visible" || recoverMissingStyles()) return;
      setStatus((current) => current === "offline" ? "connecting" : current);
      void fetchTelemetry();
    };
    const handlePageShow = () => resume();
    const handleVisibility = () => resume();
    const handleOnline = () => resume();
    const handleOffline = () => {
      setStatus("offline");
      setTransport(null);
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [fetchTelemetry]);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("pulseboard-refresh"));
    // Browser preferences are intentionally restored after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if ([2500, 5000, 10000].includes(saved)) setRefreshInterval(saved);
    if (window.localStorage.getItem("pulseboard-theme") === "day") setTheme("day");
    if (window.localStorage.getItem("pulseboard-speed-unit") === "MB/s") setSpeedUnit("MB/s");
    const savedServer = window.localStorage.getItem("pulseboard-speed-server");
    if (savedServer === "mac" || savedServer === "custom") setSpeedServer(savedServer);
    setCustomSpeedServer(window.localStorage.getItem("pulseboard-speed-custom-url") || "");
    const savedHistory = window.localStorage.getItem("pulseboard-speed-history");
    if (savedHistory) {
      try {
        setSpeedHistory((JSON.parse(savedHistory) as SpeedHistoryItem[]).slice(0, 20));
      } catch {
        window.localStorage.removeItem("pulseboard-speed-history");
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("pulseboard-refresh", String(refreshInterval));
  }, [refreshInterval]);

  useEffect(() => {
    window.localStorage.setItem("pulseboard-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("pulseboard-speed-unit", speedUnit);
  }, [speedUnit]);

  useEffect(() => {
    window.localStorage.setItem("pulseboard-speed-server", speedServer);
  }, [speedServer]);

  useEffect(() => {
    if (customSpeedServer.trim()) window.localStorage.setItem("pulseboard-speed-custom-url", customSpeedServer.trim());
  }, [customSpeedServer]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  useEffect(() => () => {
    speedTestController.current?.abort();
    speedUploadRequests.current.forEach((request) => request.abort());
  }, []);

  const processes = useMemo(() => {
    const items = telemetry?.processes.items || [];
    return [...items].sort((a, b) => sort === "cpu" ? b.cpu - a.cpu : b.memoryBytes - a.memoryBytes);
  }, [sort, telemetry]);

  const cpu = telemetry?.cpu.usage ?? 0;
  const delta = telemetry ? telemetry.cpu.usage - telemetry.cpu.previous : 0;
  const download = rate(telemetry?.network.downloadBytesPerSecond);
  const upload = rate(telemetry?.network.uploadBytesPerSecond);
  const memoryUsedPercent = telemetry ? telemetry.memory.usedBytes / telemetry.memory.totalBytes * 100 : 0;
  const wiredPercent = telemetry ? telemetry.memory.wiredBytes / telemetry.memory.totalBytes * 100 : 0;
  const compressedPercent = telemetry ? telemetry.memory.compressedBytes / telemetry.memory.totalBytes * 100 : 0;
  const appPercent = Math.max(0, memoryUsedPercent - wiredPercent - compressedPercent);
  const isHealthy = status === "live" && telemetry?.thermal.status === "Normal" && telemetry.memory.pressure !== "High";
  const isSpeedRunning = ["ping", "download", "upload"].includes(speedStage);
  const speedDisplay = speedResult ?? speedPartial;
  const primarySpeed = isSpeedRunning && speedStage !== "ping" ? currentSpeed : speedStage === "upload" && speedDisplay.upload ? speedDisplay.upload : speedDisplay.download ?? 0;
  const gaugeValue = primarySpeed || 0;
  const gaugeLabel = speedStage === "ping" ? "Ping" : speedStage === "upload" ? "Upload" : "Download";
  const speedProgressPercent = Math.round(speedProgress * 100);
  const loadedDelta = speedDisplay.loadedLatency && speedDisplay.ping ? Math.max(speedDisplay.loadedLatency - speedDisplay.ping, 0) : 0;
  const speedTicks = [0, 500, 1000, 1500, 2000, 2500, 3000];
  const speedServerLabel = speedServer === "auto" ? "Auto nearest edge" : speedServer === "mac" ? "This Mac companion" : "Custom endpoint";
  const speedServerDetail = speedMeta?.location ? `${speedMeta.location}${speedMeta.country ? ` · ${speedMeta.country}` : ""}` : speedServer === "mac" ? "Local companion on this Mac" : "Selected by viewer location";
  const canRunSpeedTest = speedServer !== "custom" || Boolean(customSpeedServer.trim());
  const stageOrder = { idle: -1, ping: 0, download: 1, upload: 2, complete: 3, error: -1 }[speedStage];
  const phaseIcon = (stage: "ping" | "download" | "upload", index: number) => {
    const icons = { ping: "⌾", download: "↓", upload: "↑" };
    return <span key={stage} className={`${speedStage === stage ? "active" : ""} ${stageOrder > index ? "done" : ""}`}>{icons[stage]}</span>;
  };

  return (
    <main className={`shell ${theme === "day" ? "themeDay" : ""}`}>
      <aside className="rail" aria-label="System views">
        <div className="brand" aria-label="Pulseboard">P</div>
        <nav>
          <button className={`railButton ${activeView === "overview" && !settingsOpen ? "active" : ""}`} aria-label="Overview" aria-current={activeView === "overview" ? "page" : undefined} onClick={() => navigateTo("overview")}><Mark>⌁</Mark><span>Overview</span></button>
          <button className={`railButton ${activeView === "performance" && !settingsOpen ? "active" : ""}`} aria-label="Performance" aria-current={activeView === "performance" ? "page" : undefined} onClick={() => navigateTo("performance")}><Mark>⌇</Mark><span>Performance</span></button>
          <button className={`railButton ${activeView === "storage" && !settingsOpen ? "active" : ""}`} aria-label="Storage" aria-current={activeView === "storage" ? "page" : undefined} onClick={() => navigateTo("storage")}><Mark>◫</Mark><span>Storage</span></button>
          <button className={`railButton ${activeView === "network" && !settingsOpen ? "active" : ""}`} aria-label="Network" aria-current={activeView === "network" ? "page" : undefined} onClick={() => navigateTo("network")}><Mark>↗</Mark><span>Network</span></button>
          <button className={`railButton ${activeView === "processes" && !settingsOpen ? "active" : ""}`} aria-label="Processes" aria-current={activeView === "processes" ? "page" : undefined} onClick={() => navigateTo("processes")}><Mark>≡</Mark><span>Processes</span></button>
          <button className={`railButton ${activeView === "tools" && !settingsOpen ? "active" : ""}`} aria-label="Tools" aria-current={activeView === "tools" ? "page" : undefined} onClick={() => navigateTo("tools")}><Mark>⌁</Mark><span>Tools</span></button>
        </nav>
        <div className="railBottom">
          <button className={`railButton ${settingsOpen ? "active" : ""}`} aria-label="Settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}><Mark>⚙</Mark><span>Settings</span></button>
          <div className="avatar">TC</div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="deviceLockup">
            <div className="deviceIcon" aria-hidden="true"><span /></div>
            <div><p>{telemetry?.device.name || "Waiting for your Mac"}</p><span>{telemetry ? `${telemetry.device.chip} · ${gb(telemetry.memory.totalBytes, 0)} GB · ${telemetry.device.os}` : "Pulseboard Companion"}</span></div>
          </div>
          <div className="topActions">
            <div className={`health ${isHealthy ? "" : status === "offline" ? "offline" : "attention"}`}><i /> {status === "offline" ? "Mac feed offline" : isHealthy ? "All systems normal" : "Checking system"}</div>
            <button className="themeButton" aria-label={theme === "night" ? "Switch to day mode" : "Switch to night mode"} aria-pressed={theme === "day"} onClick={() => setTheme((current) => current === "night" ? "day" : "night")}><span aria-hidden="true">{theme === "night" ? "☀" : "☾"}</span><b>{theme === "night" ? "Day mode" : "Night mode"}</b></button>
            <button className="pauseButton" onClick={() => setPaused((value) => !value)} disabled={status === "offline"}>{paused ? "Resume live" : "Pause live"}</button>
          </div>
        </header>

        <div className="content">
          {status === "offline" && (
            <section className="connectionBanner" role="status">
              <div className="connectionIcon">P</div>
              <div><b>No live Mac feed is available</b><span>Make sure your Mac is awake and the Pulseboard Companion is running. Mobile devices connect through the encrypted relay.</span></div>
              <button onClick={() => { setStatus("connecting"); void fetchTelemetry(); }}>Retry connection</button>
            </section>
          )}

          <section className="headingRow scrollTarget" id="overview">
            <div><p className="eyebrow">SYSTEM OVERVIEW</p><h1>{status === "live" ? (isHealthy ? "Your Mac is running smoothly." : "Your Mac needs attention.") : "Connect your Mac to begin."}</h1><p className="subhead">Real performance and health, directly from macOS.</p></div>
            <div className="updated"><span className={`dot ${paused ? "paused" : status === "offline" ? "offline" : ""}`} />{paused ? "Telemetry paused" : status === "live" ? `${transport === "relay" ? `Relay · ${relayAgeSeconds}s ago` : "Direct"} · ${new Date(telemetry!.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : status === "connecting" ? "Connecting…" : "Not connected"}</div>
          </section>

          <section className="metricsGrid scrollTarget" id="performance">
            <article className="card cpuCard">
              <div className="cardHeader"><div><p className="label">CPU LOAD</p><div className="bigValue">{cpu.toFixed(1)}<span>%</span></div></div>{status === "live" && <div className={`delta ${delta <= 0 ? "good" : "up"}`}>{delta <= 0 ? "↓" : "↑"} {Math.abs(delta).toFixed(1)}%</div>}</div>
              <div className="chart" aria-label={`CPU load ${cpu.toFixed(1)} percent`}>
                {cpuHistory.map((bar, index) => <i key={index} style={{ height: `${Math.max(2, bar)}%` }} />)}
              </div>
              <div className="cardFooter"><span>{telemetry?.device.performanceCores || 0} performance cores</span><span>{telemetry?.device.efficiencyCores || 0} efficiency cores</span></div>
            </article>

            <article className="card memoryCard">
              <div className="cardHeader"><div><p className="label">MEMORY</p><div className="bigValue">{gb(telemetry?.memory.usedBytes)}<span> GB</span></div></div><span className="quiet">of {gb(telemetry?.memory.totalBytes, 0)} GB</span></div>
              <div className="memoryBar"><i style={{ width: `${appPercent}%` }} /><b style={{ width: `${wiredPercent}%` }} /><em style={{ width: `${compressedPercent}%` }} /></div>
              <div className="memoryLegend">
                <span><i className="cyan" />Apps & active <b>{gb(Math.max(0, (telemetry?.memory.usedBytes || 0) - (telemetry?.memory.wiredBytes || 0) - (telemetry?.memory.compressedBytes || 0)))} GB</b></span>
                <span><i className="violet" />Wired <b>{gb(telemetry?.memory.wiredBytes)} GB</b></span>
                <span><i className="blue" />Compressed <b>{gb(telemetry?.memory.compressedBytes)} GB</b></span>
              </div>
              <div className="pressure"><span>Memory pressure</span><b className={(telemetry?.memory.pressure || "low").toLowerCase()}>{telemetry?.memory.pressure || "—"}</b></div>
            </article>

            <article className="card thermalCard">
              <div className="cardHeader"><div><p className="label">THERMAL PRESSURE</p><div className="thermalStatus">{telemetry?.thermal.status || "—"}</div></div><div className="thermalGlyph">°</div></div>
              <div className="thermalScale"><span /><i style={{ left: telemetry?.thermal.status === "Normal" ? "18%" : "68%" }} /></div>
              <div className="thermalLabels"><span>Normal</span><span>Elevated</span><span>Critical</span></div>
              <div className="fanRow"><span>CPU speed limit</span><b>{telemetry?.thermal.speedLimit || 0}<small>%</small></b></div>
            </article>
          </section>

          <section className="quickGrid">
            <article className="miniCard networkCard scrollTarget" id="network"><Mark>↑↓</Mark><div><p>NETWORK · {telemetry?.network.interface || "—"}</p><div className="ipAddress"><span>LOCAL IP</span><code>{telemetry?.network.address || "Unavailable"}</code></div><b>{download.value} <small>{download.unit}</small></b><span>↓ Download</span></div><div className="miniStat"><b>{upload.value} <small>{upload.unit}</small></b><span>↑ Upload</span></div></article>
            <article className="miniCard"><Mark>◷</Mark><div><p>UPTIME</p><b>{uptime(telemetry?.uptimeSeconds)}</b><span>Since last restart</span></div></article>
            <article className="miniCard"><Mark>▤</Mark><div><p>PROCESSES</p><b>{telemetry?.processes.total || 0}</b><span>{telemetry?.processes.running || 0} running</span></div><div className="miniStat"><b>{telemetry?.device.logicalCores || 0}</b><span>Logical cores</span></div></article>
            <article className="miniCard"><Mark>⌁</Mark><div><p>POWER DRAW</p><b>{telemetry?.battery.powerWatts?.toFixed(1) || "—"} <small>W</small></b><span>{telemetry?.battery.state || "Unavailable"}</span></div><span className="stable">Live</span></article>
          </section>

          <section className="lowerGrid">
            <article className="card processCard scrollTarget" id="processes">
              <div className="sectionHeader"><div><p className="label">TOP PROCESSES</p><h2>What&apos;s using your Mac</h2></div><div className="segmented"><button className={sort === "cpu" ? "selected" : ""} onClick={() => setSort("cpu")}>CPU</button><button className={sort === "memory" ? "selected" : ""} onClick={() => setSort("memory")}>Memory</button></div></div>
              <div className="processTable">
                <div className="tableHead"><span>PROCESS</span><span>PID</span><span>CPU</span><span>MEMORY</span><span>ENERGY</span></div>
                {processes.slice(0, 5).map((process, index) => (
                  <div className="processRow" key={`${process.pid}-${process.name}`}>
                    <span className="processName"><i style={{ background: palette[index % palette.length] }}>{process.name.slice(0, 1).toUpperCase()}</i><span><b>{process.name}</b><small>{process.detail}</small></span></span>
                    <span>{process.pid}</span><span><b>{process.cpu.toFixed(1)}%</b></span><span>{gb(process.memoryBytes)} GB</span><span className={`energy ${process.energy.toLowerCase()}`}>{process.energy}</span>
                  </div>
                ))}
                {!processes.length && <div className="emptyTable">Start the companion to load running processes.</div>}
              </div>
              <div className="localOnly">Process data stays on this Mac</div>
            </article>

            <div className="sideStack">
              <article className="card storageCard scrollTarget" id="storage">
                <div className="cardHeader"><div><p className="label">STORAGE</p><h2>{telemetry?.disk.name || "Macintosh HD"}</h2></div><Mark>•••</Mark></div>
                <div className="storageLead"><b>{gb(telemetry?.disk.freeBytes, 0)} GB</b><span>free of {gb(telemetry?.disk.totalBytes, 0)} GB</span></div>
                <div className="storageBar simple"><i style={{ width: `${telemetry?.disk.percent || 0}%` }} /></div>
                <div className="storageFacts"><div><span>Used</span><b>{gb(telemetry?.disk.usedBytes, 0)} GB</b></div><div><span>Available</span><b>{gb(telemetry?.disk.freeBytes, 0)} GB</b></div><div><span>Volume used</span><b>{telemetry?.disk.percent || 0}%</b></div></div>
              </article>

              <article className="card batteryCard">
                <div className="batteryTop"><div className="batteryIcon"><span style={{ width: `${telemetry?.battery.percent || 0}%` }} /></div><div><b>{telemetry?.battery.percent || 0}%</b><span>{telemetry ? `${telemetry.battery.state} · ${remaining(telemetry.battery.timeRemainingMinutes)}` : "Waiting for companion"}</span></div></div>
                <div className="batteryFacts"><div><span>Condition</span><b>{telemetry?.battery.condition || "—"}</b></div><div><span>Cycle count</span><b>{telemetry?.battery.cycleCount || 0}</b></div><div><span>Capacity</span><b>{telemetry?.battery.healthPercent || 0}%</b></div></div>
              </article>
            </div>
          </section>

          <section className="history card">
            <div><p className="label">LIVE CPU HISTORY</p><h2>Resource activity</h2></div>
            <div className="historyBars" aria-hidden="true">{cpuHistory.map((height, index) => <i key={index} style={{ height: `${Math.max(2, height)}%` }} />)}</div>
            <div className="rangeControl">{(["1H", "6H", "24H"] as const).map((item) => <button key={item} className={range === item ? "selected" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
          </section>

          <section className="speedTool card scrollTarget" id="tools" aria-labelledby="speed-test-title">
            <div className="speedHeader">
              <div>
                <p className="eyebrow">TOOLS · INTERNET</p>
                <h2 id="speed-test-title">Connection speed test</h2>
                <span>{isSpeedRunning ? `${gaugeLabel} phase · ${speedProgressPercent}%` : `${speedServerLabel} · 3 Gbps scale`}</span>
              </div>
              <div className="speedControls">
                <div className="speedUnitToggle" aria-label="Speed unit">
                  {(["Mbps", "MB/s"] as const).map((unit) => <button key={unit} className={speedUnit === unit ? "selected" : ""} onClick={() => setSpeedUnit(unit)}>{unit}</button>)}
                </div>
                <label className="speedServerSelect">
                  <span>Server</span>
                  <select value={speedServer} onChange={(event) => setSpeedServer(event.target.value as SpeedServerChoice)} aria-label="Speed test server">
                    <option value="auto">Auto nearest edge</option>
                    <option value="mac">This Mac companion</option>
                    <option value="custom">Custom endpoint</option>
                  </select>
                </label>
                {speedServer === "custom" && (
                  <input className="speedCustomInput" value={customSpeedServer} onChange={(event) => setCustomSpeedServer(event.target.value)} placeholder="https://server.example/speed-test" aria-label="Custom speed-test endpoint URL" />
                )}
                <button className={`speedAction ${isSpeedRunning ? "testing" : ""}`} disabled={!canRunSpeedTest && !isSpeedRunning} onClick={() => void runSpeedTest()}>
                  {isSpeedRunning ? "Stop test" : speedResult ? "Test again" : "Run speed test"}
                </button>
              </div>
            </div>

            <div className={`speedDial ${isSpeedRunning ? "testing" : ""}`} style={{ "--needle-angle": `${gaugeAngle(gaugeValue)}deg`, "--speed-progress": `${speedRatio(gaugeValue) * 75}%` } as React.CSSProperties}>
              <div className="dialArc" />
              {speedTicks.map((tick) => <span key={tick} className="dialTick" style={tickPosition(tick)}>{formatTick(tick, speedUnit)}</span>)}
              <div className="dialNeedle" />
              <div className="dialReadout">
                <b>{primarySpeed ? formatSpeed(primarySpeed, speedUnit) : "—"}</b>
                <span>{speedUnit}</span>
              </div>
              <div className="speedPhases" aria-label="Test stages">
                {(["ping", "download", "upload"] as const).map((stage, index) => phaseIcon(stage, index))}
              </div>
            </div>

            <div className="speedMetricPanel" aria-live="polite">
              <div className="speedMetric compact"><i>↔</i><span>Ping</span><b>{speedDisplay.ping ? speedDisplay.ping.toFixed(0) : "—"}</b><small>ms</small></div>
              <div className="speedMetric featured"><i>↓</i><span>Download</span><b>{speedDisplay.download ? formatSpeed(speedDisplay.download, speedUnit) : "—"}</b><small>{speedUnit}</small></div>
              <div className="speedMetric compact"><i>≈</i><span>Jitter</span><b>{speedDisplay.jitter ? speedDisplay.jitter.toFixed(0) : "—"}</b><small>ms</small></div>
              <div className="speedMetric"><i>↑</i><span>Upload</span><b>{speedDisplay.upload ? formatSpeed(speedDisplay.upload, speedUnit) : "—"}</b><small>{speedUnit}</small></div>
              <div className="speedMetric compact"><i>∆</i><span>Loaded</span><b>{speedDisplay.loadedLatency ? speedDisplay.loadedLatency.toFixed(0) : "—"}</b><small>{loadedDelta ? `+${loadedDelta.toFixed(0)} ms · ${speedDisplay.bufferbloat}` : "ms"}</small></div>
            </div>

            <div className="speedBottom">
              <div className="speedEndpoint">
                <b>{speedMeta?.clientIp || "This device"}</b>
                <span>{speedResult ? speedQuality(speedResult.download) : isSpeedRunning ? `${gaugeLabel} in progress` : "Ready"}</span>
              </div>
              <div className="speedEndpoint right">
                <b>{speedMeta?.service || "Pulseboard edge"}</b>
                <span>{speedServerDetail}</span>
              </div>
              {speedError && <p className="speedError" role="status">{speedError}</p>}
              <small>Runs about 25 seconds. Custom servers must expose the Pulseboard speed-test API with browser access enabled.</small>
            </div>
            {speedHistory.length > 0 && (
              <div className="speedHistory">
                <div className="tableHead"><span>TIME</span><span>PING</span><span>DOWN</span><span>UP</span><span>LOADED</span></div>
                {speedHistory.slice(0, 4).map((item) => (
                  <div className="speedHistoryRow" key={`${item.timestamp}-${item.download}-${item.upload}`}>
                    <span>{item.timestamp}</span><span>{item.ping.toFixed(0)} ms</span><span>{formatSpeed(item.download, speedUnit)}</span><span>{formatSpeed(item.upload, speedUnit)}</span><span>{item.loadedLatency.toFixed(0)} ms · {item.bufferbloat}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <footer><span>Pulseboard · Real telemetry · {transport === "relay" ? "Encrypted relay" : transport === "direct" ? "Direct local" : "Disconnected"}</span><span>{telemetry ? `${telemetry.device.os} · ${telemetry.device.model}` : "Waiting for your Mac"}</span></footer>
        </div>
      </section>

      {settingsOpen && (
        <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settingsPanel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="settingsHeader"><div><p className="eyebrow">PULSEBOARD</p><h2 id="settings-title">Settings</h2></div><button className="closeButton" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button></div>
            <div className="settingGroup">
              <div><b>Refresh speed</b><span>How often Pulseboard checks the active telemetry connection for new metrics.</span></div>
              <div className="refreshChoices">
                {[{ value: 2500, label: "Fast", note: "2.5s" }, { value: 5000, label: "Balanced", note: "5s" }, { value: 10000, label: "Efficient", note: "10s" }].map((choice) => (
                  <button key={choice.value} className={refreshInterval === choice.value ? "selected" : ""} onClick={() => setRefreshInterval(choice.value)}><b>{choice.label}</b><span>{choice.note}</span></button>
                ))}
              </div>
            </div>
            <div className="settingGroup connectionSetting">
              <div><b>Mac companion</b><span>Runs quietly in the background, starts automatically, and securely relays metrics to your mobile devices.</span></div>
              <div className={`connectionPill ${status}`}><i />{status === "live" ? (transport === "relay" ? "Relay connected" : "Direct connected") : status === "connecting" ? "Connecting" : "Offline"}</div>
              <button className="settingsAction" onClick={() => { setStatus("connecting"); void fetchTelemetry(); }}>Reconnect now</button>
            </div>
            <div className="privacyNote"><Mark>⌁</Mark><div><b>Private by design</b><span>Direct viewing stays on your Mac. Mobile viewing uses an authenticated encrypted relay that keeps only the newest telemetry snapshot.</span></div></div>
            <div className="settingsFooter"><span>Current connection</span><code>{transport === "relay" ? "Encrypted cloud relay" : transport === "direct" ? "127.0.0.1:4319" : "Not connected"}</code></div>
          </section>
        </div>
      )}
    </main>
  );
}
