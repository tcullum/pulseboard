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
  device: { id?: string; name: string; model: string; chip: string; os: string; platform?: "macos" | "windows" | string; role?: string; logicalCores: number; performanceCores: number; efficiencyCores: number };
  cpu: { usage: number; previous: number };
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; wiredBytes: number; compressedBytes: number; pressure: "Low" | "Medium" | "High" };
  disk: { name: string; totalBytes: number; usedBytes: number; freeBytes: number; percent: number };
  battery: { available?: boolean; percent: number; state: string; timeRemainingMinutes: number | null; cycleCount: number; healthPercent: number; condition: string; powerWatts: number | null };
  thermal: { available?: boolean; status: string; speedLimit: number };
  network: { interface: string; address: string; downloadBytesPerSecond: number; uploadBytesPerSecond: number };
  system?: { loadAverage?: number[] };
  uptimeSeconds: number;
  processes: { total: number; running: number; items: ProcessItem[] };
  plex?: {
    available: boolean;
    status: string;
    processes: number;
    cpu: number;
    memoryBytes: number;
    detail: string;
    playback?: {
      configured: boolean;
      reachable: boolean;
      server: string;
      version?: string;
      sessions: number;
      transcodeSessions: number;
      detail?: string;
      items: Array<{
        state: string;
        title: string;
        subtitle?: string;
        type: string;
        user?: string;
        player: string;
        product?: string;
        platform?: string;
        location?: string;
        quality: string;
        decision: string;
        transcode: boolean;
        progressPercent: number;
        remainingSeconds: number;
        bandwidthKbps: number;
        stream?: { container?: string; video?: string; audio?: string; resolution?: string; protocol?: string; speed?: number; throttled?: boolean };
      }>;
    };
  };
};

type TelemetryDevice = {
  id: string;
  name: string;
  platform: string;
  os: string;
  chip: string;
  ageSeconds: number;
  stale: boolean;
  displayName?: string;
  eyebrow?: string;
};

type FleetSnapshot = {
  telemetry?: Telemetry;
  status: "live" | "offline";
  transport: "direct" | "relay";
  ageSeconds: number;
  stale: boolean;
};

const COMPANION_URL = "http://127.0.0.1:4319/telemetry";
const WINDOWS_PLEX_ID = "windows-win-plex";
const MACBOOK_ID = "device-thomas-s-macbook-pro";
const LOCAL_TELEMETRY_TIMEOUT_MS = 6_500;
const OFFLINE_AFTER_MISSED_POLLS = 3;
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

function shortDuration(seconds = 0) {
  if (!seconds) return "Live";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

function deviceId(telemetry: Telemetry) {
  return telemetry.device.id || `${telemetry.device.platform || "device"}-${telemetry.device.name}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function platformLabel(platform?: string) {
  return platform === "windows" ? "Windows" : platform === "macos" ? "Mac" : platform === "linux" ? "Linux" : "Device";
}

function isWindowsClient(device?: { id?: string; platform?: string; name?: string }) {
  return device?.platform === "windows" || device?.id === WINDOWS_PLEX_ID || /win-plex|windows plex/i.test(device?.name || "");
}

function isMacBookClient(device?: { id?: string; platform?: string; name?: string }) {
  return device?.platform === "macos" || device?.id === MACBOOK_ID || /thomas.*macbook pro/i.test(device?.name || "");
}

function isLinuxDellFedora(device?: { id?: string; platform?: string; name?: string; model?: string; os?: string }) {
  return device?.platform === "linux" && (/fedora/i.test(device?.name || "") || /fedora/i.test(device?.os || "")) && /xps|dell/i.test(device?.model || "");
}

function clientDisplayName(device?: { id?: string; platform?: string; name?: string }) {
  if (isWindowsClient(device)) return "Windows Plex";
  if (isMacBookClient(device)) return "Thomas's MacBook Pro";
  if (isLinuxDellFedora(device)) return "Linux Dell Fedora";
  return device?.name || "Pulseboard client";
}

function clientEyebrow(device?: { id?: string; platform?: string; name?: string }) {
  if (isWindowsClient(device)) return "Windows Plex";
  if (isMacBookClient(device)) return "MacBook";
  return platformLabel(device?.platform);
}

function selectedMatchesTelemetry(selectedId: string, telemetry: Telemetry) {
  const actualId = deviceId(telemetry);
  if (selectedId === actualId) return true;
  if (selectedId === WINDOWS_PLEX_ID && isWindowsClient(telemetry.device)) return true;
  if (selectedId === MACBOOK_ID && isMacBookClient(telemetry.device)) return true;
  return false;
}

export default function Home() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [sort, setSort] = useState<"cpu" | "memory">("cpu");
  const [paused, setPaused] = useState(false);
  const [cpuHistory, setCpuHistory] = useState<number[]>(Array(36).fill(0));
  const [activeView, setActiveView] = useState("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(2500);
  const [transport, setTransport] = useState<"direct" | "relay" | null>(null);
  const [relayAgeSeconds, setRelayAgeSeconds] = useState(0);
  const [theme, setTheme] = useState<"night" | "day">("night");
  const [selectedDeviceId, setSelectedDeviceId] = useState(WINDOWS_PLEX_ID);
  const [relayDevices, setRelayDevices] = useState<TelemetryDevice[]>([]);
  const [fleetSnapshots, setFleetSnapshots] = useState<Record<string, FleetSnapshot>>({});
  const fetchInFlight = useRef<Promise<void> | null>(null);
  const fleetFetchId = useRef(0);
  const missedTelemetryPolls = useRef(0);
  const lastGoodTelemetry = useRef<Telemetry | null>(null);

  const navigateTo = useCallback((target: string) => {
    setActiveView(target);
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const refreshFleetSnapshots = useCallback((devices: TelemetryDevice[]) => {
    const targets = devices.filter((device, index, list) => device.id && list.findIndex((item) => item.id === device.id) === index).slice(0, 3);
    if (!targets.length) return;
    const requestId = ++fleetFetchId.current;
    void Promise.all(targets.map(async (device) => {
      try {
        const response = await fetch(`/api/telemetry?device=${encodeURIComponent(device.id)}`, { cache: "no-store", credentials: "same-origin" });
        const relay = await response.json() as { telemetry?: Telemetry; ageSeconds?: number; stale?: boolean };
        if (!response.ok || !relay.telemetry) throw new Error("No relay telemetry");
        return {
          id: device.id,
          snapshot: {
            telemetry: relay.telemetry,
            status: relay.stale ? "offline" as const : "live" as const,
            transport: "relay" as const,
            ageSeconds: relay.ageSeconds || device.ageSeconds || 0,
            stale: Boolean(relay.stale),
          },
        };
      } catch {
        return {
          id: device.id,
          snapshot: {
            status: "offline" as const,
            transport: "relay" as const,
            ageSeconds: device.ageSeconds || 0,
            stale: true,
          },
        };
      }
    })).then((results) => {
      if (requestId !== fleetFetchId.current) return;
      setFleetSnapshots((current) => {
        const next = { ...current };
        for (const result of results) next[result.id] = result.snapshot;
        return next;
      });
    }).catch(() => {});
  }, []);

  const fetchTelemetry = useCallback(() => {
    if (fetchInFlight.current) return fetchInFlight.current;

    const request = (async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), LOCAL_TELEMETRY_TIMEOUT_MS);
      try {
        const response = await fetch(COMPANION_URL, { cache: "no-store", mode: "cors", signal: controller.signal });
        if (!response.ok) throw new Error("Companion unavailable");
        const next = await response.json() as Telemetry;
        if (!selectedMatchesTelemetry(selectedDeviceId, next)) throw new Error("Different local companion");
        missedTelemetryPolls.current = 0;
        lastGoodTelemetry.current = next;
        setTelemetry(next);
        setCpuHistory((history) => [...history.slice(1), next.cpu.usage]);
        setStatus("live");
        setTransport("direct");
        setRelayAgeSeconds(0);
        setRelayDevices((devices) => {
          const local = { id: deviceId(next), name: next.device.name, platform: next.device.platform || "macos", os: next.device.os, chip: next.device.chip, ageSeconds: 0, stale: false };
          return [local, ...devices.filter((device) => device.id !== local.id)];
        });
        setFleetSnapshots((current) => ({
          ...current,
          [deviceId(next)]: { telemetry: next, status: "live", transport: "direct", ageSeconds: 0, stale: false },
        }));
        void fetch("/api/telemetry", { cache: "no-store", credentials: "same-origin" })
          .then(async (relayResponse) => {
            const relay = await relayResponse.json() as { devices?: TelemetryDevice[] };
            if (relay.devices) {
              setRelayDevices((devices) => [...devices, ...relay.devices!].filter((device, index, list) => list.findIndex((item) => item.id === device.id) === index));
              refreshFleetSnapshots(relay.devices);
            }
          })
          .catch(() => {});
        return;
      } catch {
        try {
          const relayUrl = `/api/telemetry?device=${encodeURIComponent(selectedDeviceId)}`;
          const relayResponse = await fetch(relayUrl, { cache: "no-store", credentials: "same-origin" });
          const relay = await relayResponse.json() as { telemetry?: Telemetry; devices?: TelemetryDevice[]; ageSeconds?: number; stale?: boolean };
          if (relay.devices) {
            setRelayDevices(relay.devices);
            refreshFleetSnapshots(relay.devices);
          }
          if (!relayResponse.ok || !relay.telemetry) throw new Error("Relay unavailable");
          setFleetSnapshots((current) => ({
            ...current,
            [deviceId(relay.telemetry!)]: {
              telemetry: relay.telemetry,
              status: relay.stale ? "offline" : "live",
              transport: "relay",
              ageSeconds: relay.ageSeconds || 0,
              stale: Boolean(relay.stale),
            },
          }));
          if (relay.stale) {
            setRelayAgeSeconds(relay.ageSeconds || 0);
            setTransport("relay");
            setStatus("offline");
            return;
          }
          missedTelemetryPolls.current = 0;
          lastGoodTelemetry.current = relay.telemetry;
          setTelemetry(relay.telemetry);
          setCpuHistory((history) => [...history.slice(1), relay.telemetry.cpu.usage]);
          setStatus("live");
          setTransport("relay");
          setRelayAgeSeconds(relay.ageSeconds || 0);
        } catch {
          missedTelemetryPolls.current += 1;
          const cached = lastGoodTelemetry.current;
          if (cached && selectedMatchesTelemetry(selectedDeviceId, cached) && missedTelemetryPolls.current < OFFLINE_AFTER_MISSED_POLLS) {
            setStatus("live");
            return;
          }
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
  }, [refreshFleetSnapshots, selectedDeviceId]);

  /* Legacy speed-test implementation removed from the interface.
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

    if (speedServer === "iperf3") {
      const selectedServer = iperf3Servers.find((server) => server.id === iperf3ServerId) ?? iperf3Servers[0];
      if (!selectedServer) {
        setSpeedError("No iPerf3 servers are available.");
        speedTestController.current = null;
        return;
      }

      setSpeedMeta({
        clientIp: "This machine",
        service: `${selectedServer.city} · ${selectedServer.provider}`,
        location: `${selectedServer.host}:${selectedServer.ports.join("/")}`,
        country: selectedServer.country,
      });

      const phaseStarted = performance.now();
      const phaseTimer = window.setInterval(() => {
        const elapsed = performance.now() - phaseStarted;
        if (elapsed < 2_500) {
          setSpeedStage("ping");
          setSpeedProgress(Math.min(elapsed / 2_500, 1));
        } else if (elapsed < 12_500) {
          setSpeedStage("download");
          setSpeedProgress(Math.min((elapsed - 2_500) / 10_000, 1));
        } else {
          setSpeedStage("upload");
          setSpeedProgress(Math.min((elapsed - 12_500) / 10_000, 1));
        }
      }, 250);

      try {
        setSpeedStage("ping");
        const response = await fetch(IPERF3_TEST_URL, {
          method: "POST",
          cache: "no-store",
          mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverId: selectedServer.id }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as { result?: SpeedResult; server?: Iperf3Server; port?: number | string; error?: string } | null;
        if (!response.ok || !payload?.result) {
          throw new Error(payload?.error || "The local companion could not run the iPerf3 test.");
        }
        const server = payload.server ?? selectedServer;
        const result = payload.result;
        setSpeedMeta({
          clientIp: "This machine",
          service: `${server.city} · ${server.provider}`,
          location: `${server.host}:${payload.port ?? server.ports[0]}`,
          country: server.country,
        });
        setSpeedResult(result);
        setSpeedPartial(result);
        setCurrentSpeed(result.download);
        setSpeedProgress(1);
        setSpeedStage("complete");
        setSpeedHistory((history) => {
          const next = [{ ...result, timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }, ...history].slice(0, 20);
          window.localStorage.setItem("pulseboard-speed-history", JSON.stringify(next));
          return next;
        });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          setSpeedStage("idle");
          setSpeedError("iPerf3 test stopped. You can run it again whenever you’re ready.");
        } else {
          setSpeedStage("error");
          setSpeedError(error instanceof Error ? error.message : "The iPerf3 test could not finish.");
        }
      } finally {
        window.clearInterval(phaseTimer);
        if (speedTestController.current === controller) speedTestController.current = null;
      }
      return;
    }

    const speedBaseUrl = speedServer === "mac"
      ? LOCAL_SPEED_TEST_URL
      : speedServer === "custom" && customSpeedServer.trim()
        ? normalizeSpeedBase(customSpeedServer)
        : "/api/speed-test";
    const serverName = speedServer === "mac" ? "Local companion" : speedServer === "custom" ? "Custom server" : "Pulseboard edge";
    const customFailureMessage = "Custom server is unreachable or does not expose the Pulseboard speed-test API with HTTPS and CORS enabled.";
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
        let response: Response;
        try {
          response = await fetch(speedTestUrl(speedBaseUrl, "ping"), {
            cache: "no-store",
            credentials: speedBaseUrl.startsWith("/") ? "same-origin" : "omit",
            signal: controller.signal,
          });
        } catch {
          throw new Error(speedServer === "custom" ? customFailureMessage : `${serverName} did not respond.`);
        }
        if (!response.ok) throw new Error(speedServer === "custom" ? customFailureMessage : `${serverName} did not respond.`);
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
          let response: Response;
          try {
            response = await fetch(speedTestUrl(speedBaseUrl, "download", { size, stream }), {
              cache: "no-store",
              credentials: speedBaseUrl.startsWith("/") ? "same-origin" : "omit",
              signal: controller.signal,
            });
          } catch {
            throw new Error(speedServer === "custom" ? customFailureMessage : `The download test to ${serverName} could not finish.`);
          }
          if (!response.ok) throw new Error(speedServer === "custom" ? customFailureMessage : `The download test to ${serverName} could not finish.`);

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
              else reject(new Error(request.status === 413 ? "The upload sample was rejected by the server size limit." : speedServer === "custom" ? customFailureMessage : `The upload test to ${serverName} could not finish.`));
            };
            request.onerror = () => {
              controller.signal.removeEventListener("abort", abort);
              speedUploadRequests.current = speedUploadRequests.current.filter((item) => item !== request);
              reject(new Error(speedServer === "custom" ? customFailureMessage : "The upload endpoint could not be reached."));
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
  }, [customSpeedServer, iperf3ServerId, iperf3Servers, speedServer]);
  */

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
    const savedDevice = window.localStorage.getItem("pulseboard-device");
    setSelectedDeviceId(!savedDevice || savedDevice === "local" ? WINDOWS_PLEX_ID : savedDevice);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("pulseboard-refresh", String(refreshInterval));
  }, [refreshInterval]);

  useEffect(() => {
    window.localStorage.setItem("pulseboard-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("pulseboard-device", selectedDeviceId);
    missedTelemetryPolls.current = 0;
    lastGoodTelemetry.current = null;
  }, [selectedDeviceId]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setAddMachineOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  const processes = useMemo(() => {
    const items = telemetry?.processes.items || [];
    return [...items].sort((a, b) => sort === "cpu" ? b.cpu - a.cpu : b.memoryBytes - a.memoryBytes);
  }, [sort, telemetry]);

  const cpu = telemetry?.cpu.usage ?? 0;
  const delta = telemetry ? telemetry.cpu.usage - telemetry.cpu.previous : 0;
  const cpuAverage = cpuHistory.reduce((total, value) => total + value, 0) / Math.max(cpuHistory.length, 1);
  const download = rate(telemetry?.network.downloadBytesPerSecond);
  const upload = rate(telemetry?.network.uploadBytesPerSecond);
  const memoryTotal = telemetry?.memory.totalBytes || 0;
  const memoryUsedPercent = memoryTotal ? (telemetry!.memory.usedBytes / memoryTotal) * 100 : 0;
  const wiredPercent = memoryTotal ? (telemetry!.memory.wiredBytes / memoryTotal) * 100 : 0;
  const compressedPercent = memoryTotal ? (telemetry!.memory.compressedBytes / memoryTotal) * 100 : 0;
  const appPercent = Math.max(0, memoryUsedPercent - wiredPercent - compressedPercent);
  const freeMemoryPercent = memoryTotal ? (telemetry!.memory.freeBytes / memoryTotal) * 100 : 0;
  const activePlatform = telemetry?.device.platform || (selectedDeviceId === WINDOWS_PLEX_ID ? "windows" : "macos");
  const sampleAgeSeconds = telemetry ? (transport === "relay" ? relayAgeSeconds : 0) : null;
  const showThermalCard = activePlatform !== "windows" && telemetry?.thermal.available !== false;
  const thermalNeedsAttention = showThermalCard && telemetry?.thermal.status !== "Normal";
  const isHealthy = status === "live" && !thermalNeedsAttention && telemetry?.memory.pressure !== "High";
  const activePlatformName = platformLabel(activePlatform);
  const activeDisplayName = telemetry ? clientDisplayName(telemetry.device) : selectedDeviceId === WINDOWS_PLEX_ID ? "Windows Plex" : "Thomas's MacBook Pro";
  const connectionLabel = status === "offline" ? `${activePlatformName} feed offline` : isHealthy ? "All systems normal" : "Checking system";
  const showPlexCard = activePlatform === "windows";
  const plexPlayback = telemetry?.plex?.playback;
  const plexSessions = plexPlayback?.items || [];
  const headline = status === "live"
    ? isHealthy
      ? `${activeDisplayName} is running smoothly.`
      : `${activeDisplayName} needs attention.`
    : `Connect ${activeDisplayName} to begin.`;
  const windowsRelay = relayDevices.find(isWindowsClient);
  const macRelay = relayDevices.find(isMacBookClient);
  const deviceOptions = [
    { ...(windowsRelay || { id: WINDOWS_PLEX_ID, name: "Windows Plex", platform: "windows", os: "Windows 11 Plex client", chip: "" }), displayName: "Windows Plex", eyebrow: "Windows Plex" },
    { ...(macRelay || { id: MACBOOK_ID, name: "Thomas's MacBook Pro", platform: "macos", os: "macOS", chip: "" }), displayName: "Thomas's MacBook Pro", eyebrow: "MacBook" },
    ...relayDevices.filter((device) => !isWindowsClient(device) && !isMacBookClient(device)).map((device) => ({ ...device, displayName: clientDisplayName(device), eyebrow: clientEyebrow(device) })),
  ].filter((device, index, list) => list.findIndex((item) => item.id === device.id) === index);
  const fleetSlots = deviceOptions.slice(0, 3);
  const fleetPlaceholders = Array.from({ length: Math.max(0, 3 - fleetSlots.length) }, (_, index) => ({ id: `add-machine-${index + 1}`, displayName: "Add machine", eyebrow: "Available slot", platform: "slot", os: "Install Pulseboard Companion", chip: "", ageSeconds: 0, stale: true }));
  const fleetCards = [...fleetSlots, ...fleetPlaceholders];
  const liveFleetCount = fleetSlots.filter((device) => {
    const snapshot = fleetSnapshots[device.id];
    return snapshot?.status === "live" && !snapshot.stale;
  }).length;
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
            <div><p>{telemetry ? activeDisplayName : "Waiting for companion"}</p><span>{telemetry ? `${telemetry.device.chip} · ${gb(telemetry.memory.totalBytes, 0)} GB · ${telemetry.device.os}` : "Pulseboard Companion"}</span></div>
          </div>
          <div className="clientSwitch" aria-label="Pulseboard client">
            {deviceOptions.map((device) => (
              <button key={device.id} className={selectedDeviceId === device.id ? "selected" : ""} onClick={() => { setStatus("connecting"); setSelectedDeviceId(device.id); }}>
                <span>{device.eyebrow}</span>
                <b>{device.displayName}</b>
              </button>
            ))}
          </div>
          <div className="topActions">
            <div className={`health ${isHealthy ? "" : status === "offline" ? "offline" : "attention"}`}><i /> {connectionLabel}</div>
            <button className="themeButton" aria-label={theme === "night" ? "Switch to day mode" : "Switch to night mode"} aria-pressed={theme === "day"} onClick={() => setTheme((current) => current === "night" ? "day" : "night")}><span aria-hidden="true">{theme === "night" ? "☀" : "☾"}</span><b>{theme === "night" ? "Day mode" : "Night mode"}</b></button>
            <button className="pauseButton" onClick={() => setPaused((value) => !value)} disabled={status === "offline"}>{paused ? "Resume live" : "Pause live"}</button>
          </div>
        </header>

        <div className="content">
          {status === "offline" && (
            <section className="connectionBanner" role="status">
              <div className="connectionIcon">P</div>
              <div><b>No live {activePlatformName} feed is available</b><span>Make sure the selected machine is awake and the Pulseboard Companion is running. Remote viewing uses the encrypted relay.</span></div>
              <button onClick={() => { setStatus("connecting"); void fetchTelemetry(); }}>Retry connection</button>
            </section>
          )}

          <section className="fleetOverview scrollTarget" id="overview" aria-labelledby="fleet-title">
            <div className="fleetHeader">
              <div><p className="eyebrow">FLEET OVERVIEW</p><h1 id="fleet-title">Pulseboard fleet</h1><p className="subhead">{liveFleetCount} of {fleetSlots.length} machines live · up to 3 dashboard slots</p></div>
              <div className="fleetLegend"><span><i /> Live telemetry</span><span><i className="offline" /> Needs attention</span></div>
            </div>
            <div className="fleetGrid" aria-label="Machine dashboards">
              {fleetCards.map((device) => {
                const isPlaceholder = device.platform === "slot";
                const selected = selectedDeviceId === device.id;
                const selectedFallback: FleetSnapshot | null = telemetry && selected
                  ? { telemetry, status: status === "live" ? "live" : "offline", transport: transport || "relay", ageSeconds: relayAgeSeconds, stale: status === "offline" }
                  : null;
                const snapshot = isPlaceholder ? null : fleetSnapshots[device.id] || selectedFallback;
                const machine = snapshot?.telemetry;
                const memoryPercent = machine?.memory.totalBytes ? Math.round(machine.memory.usedBytes / machine.memory.totalBytes * 100) : 0;
                const diskPercent = machine?.disk.percent || 0;
                const online = snapshot?.status === "live" && !snapshot.stale;
                if (isPlaceholder) {
                  return (
                    <button className="fleetCard addMachine" key={device.id} onClick={() => setAddMachineOpen(true)}>
                      <div className="fleetCardTop"><div><span>{device.eyebrow}</span><b>{device.displayName}</b></div><i>Ready</i></div>
                      <p>Install the Fedora/Linux companion and this slot will become its live dashboard.</p>
                      <div className="fleetAddGlyph">+</div>
                    </button>
                  );
                }
                return (
                  <button className={`fleetCard ${selected ? "selected" : ""} ${online ? "live" : "offline"}`} key={device.id} onClick={() => { setStatus("connecting"); setSelectedDeviceId(device.id); }}>
                    <div className="fleetCardTop"><div><span>{device.eyebrow}</span><b>{device.displayName}</b></div><i>{online ? "Live" : "Offline"}</i></div>
                    <p>{machine ? `${machine.device.os} · ${machine.device.chip}` : device.os || "Waiting for companion"}</p>
                    <div className="fleetVitals">
                      <div><span>CPU</span><b>{machine ? `${machine.cpu.usage.toFixed(1)}%` : "—"}</b></div>
                      <div><span>Memory</span><b>{machine ? `${memoryPercent}%` : "—"}</b></div>
                      <div><span>Disk</span><b>{machine ? `${diskPercent}%` : "—"}</b></div>
                    </div>
                    <div className="fleetBars" aria-hidden="true"><i style={{ width: `${machine?.cpu.usage || 0}%` }} /><b style={{ width: `${memoryPercent}%` }} /><em style={{ width: `${diskPercent}%` }} /></div>
                    <div className="fleetFooter"><span>{snapshot?.transport === "direct" ? "Direct local" : "Encrypted relay"}</span><span>{snapshot ? `${snapshot.ageSeconds}s sample` : "No sample"}</span></div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="headingRow scrollTarget" id="selected-machine">
            <div><p className="eyebrow">SELECTED MACHINE</p><h1>{headline}</h1><p className="subhead">Detailed performance and health from {activeDisplayName}.</p></div>
            <div className="updated"><span className={`dot ${paused ? "paused" : status === "offline" ? "offline" : ""}`} />{paused ? "Telemetry paused" : status === "live" ? `${transport === "relay" ? `Relay · ${relayAgeSeconds}s ago` : "Direct"} · ${new Date(telemetry!.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : status === "connecting" ? "Connecting…" : "Not connected"}</div>
          </section>

          <section className={`metricsGrid ${showThermalCard ? "" : "withoutThermal"} scrollTarget`} id="performance">
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

            {showThermalCard && (
            <article className="card thermalCard">
              <div className="cardHeader"><div><p className="label">THERMAL PRESSURE</p><div className="thermalStatus">{telemetry?.thermal.status || "—"}</div></div><div className="thermalGlyph">°</div></div>
              <div className={`thermalScale ${telemetry?.thermal.available === false ? "unavailable" : ""}`}><span /><i style={{ left: telemetry?.thermal.status === "Normal" ? "18%" : telemetry?.thermal.status === "Elevated" ? "68%" : "18%" }} /></div>
              <div className="thermalLabels"><span>Normal</span><span>Elevated</span><span>Critical</span></div>
              <div className="fanRow"><span>{telemetry?.thermal.available === false ? "Windows thermal sensors" : "CPU speed limit"}</span><b>{telemetry?.thermal.available === false ? "Unavailable" : <>{telemetry?.thermal.speedLimit || 0}<small>%</small></>}</b></div>
            </article>
            )}
          </section>

          <section className="quickGrid">
            <article className="miniCard networkCard scrollTarget" id="network"><Mark>↑↓</Mark><div><p>NETWORK · {telemetry?.network.interface || "—"}</p><div className="ipAddress"><span>LOCAL IP</span><code>{telemetry?.network.address || "Unavailable"}</code></div><b>{download.value} <small>{download.unit}</small></b><span>↓ Download</span></div><div className="miniStat"><b>{upload.value} <small>{upload.unit}</small></b><span>↑ Upload</span></div></article>
            <article className="miniCard"><Mark>◷</Mark><div><p>UPTIME</p><b>{uptime(telemetry?.uptimeSeconds)}</b><span>{telemetry?.system?.loadAverage?.length ? `1m load ${telemetry.system.loadAverage[0].toFixed(2)}` : "Since last restart"}</span></div></article>
            <article className="miniCard"><Mark>▤</Mark><div><p>PROCESSES</p><b>{telemetry?.processes.total || 0}</b><span>{telemetry?.processes.running || 0} running</span></div><div className="miniStat"><b>{telemetry?.device.logicalCores || 0}</b><span>Logical cores</span></div></article>
            <article className="miniCard"><Mark>⌁</Mark><div><p>POWER DRAW</p><b>{telemetry?.battery.powerWatts?.toFixed(1) || "—"} <small>W</small></b><span>{telemetry?.battery.state || "Unavailable"}</span></div><span className="stable">Live</span></article>
          </section>

          <section className="lowerGrid">
            <article className="card processCard scrollTarget" id="processes">
              <div className="sectionHeader"><div><p className="label">TOP PROCESSES</p><h2>What&apos;s using {telemetry ? activeDisplayName : "this machine"}</h2></div><div className="segmented"><button className={sort === "cpu" ? "selected" : ""} onClick={() => setSort("cpu")}>CPU</button><button className={sort === "memory" ? "selected" : ""} onClick={() => setSort("memory")}>Memory</button></div></div>
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
              <div className="localOnly">Process data stays with the selected Pulseboard client</div>
            </article>

            <div className="sideStack">
              <article className="card storageCard scrollTarget" id="storage">
                <div className="cardHeader"><div><p className="label">STORAGE</p><h2>{telemetry?.disk.name || "Macintosh HD"}</h2></div><Mark>•••</Mark></div>
                <div className="storageLead"><b>{gb(telemetry?.disk.freeBytes, 0)} GB</b><span>free of {gb(telemetry?.disk.totalBytes, 0)} GB</span></div>
                <div className="storageBar simple"><i style={{ width: `${telemetry?.disk.percent || 0}%` }} /></div>
                <div className="storageFacts"><div><span>Used</span><b>{gb(telemetry?.disk.usedBytes, 0)} GB</b></div><div><span>Available</span><b>{gb(telemetry?.disk.freeBytes, 0)} GB</b></div><div><span>Volume used</span><b>{telemetry?.disk.percent || 0}%</b></div></div>
              </article>

              {showPlexCard && (
                <article className="card plexCard scrollTarget" id="plex">
                  <div className="cardHeader"><div><p className="label">PLEX CLIENT</p><h2>{telemetry?.plex?.status || "Waiting for Plex"}</h2></div><span className={`plexBadge ${telemetry?.plex?.available ? "online" : ""}`}>{plexPlayback?.sessions ? "Playing" : telemetry?.plex?.available ? "Active" : "Idle"}</span></div>
                  <p>{telemetry?.plex?.detail || "Monitor Plex or Plexamp activity on this Windows client."}</p>
                  <div className="plexStats">
                    <div><span>Processes</span><b>{telemetry?.plex?.processes || 0}</b></div>
                    <div><span>CPU</span><b>{telemetry?.plex?.cpu?.toFixed(1) || "0.0"}%</b></div>
                    <div><span>Memory</span><b>{gb(telemetry?.plex?.memoryBytes || 0)} GB</b></div>
                    <div><span>Sessions</span><b>{plexPlayback?.sessions || 0}</b></div>
                    <div><span>Transcodes</span><b>{plexPlayback?.transcodeSessions || 0}</b></div>
                    <div><span>Server</span><b>{plexPlayback?.reachable ? "Online" : plexPlayback?.configured ? "Offline" : "Token"}</b></div>
                  </div>
                  {plexSessions.length > 0 ? (
                    <div className="plexNowPlaying" aria-label="Plex playback sessions">
                      {plexSessions.map((session) => (
                        <div className="plexSession" key={`${session.player}-${session.title}-${session.progressPercent}`}>
                          <div className="plexSessionTop">
                            <span className={`plexState ${session.transcode ? "transcode" : ""}`}>{session.transcode ? "Transcode" : session.decision}</span>
                            <b>{session.title}</b>
                            <small>{session.state} - {shortDuration(session.remainingSeconds)}</small>
                          </div>
                          <div className="plexProgress"><i style={{ width: `${session.progressPercent}%` }} /></div>
                          <div className="plexSessionMeta">
                            <span>{session.player}{session.user ? ` - ${session.user}` : ""}</span>
                            <span>{session.quality}</span>
                            <span>{session.bandwidthKbps ? `${session.bandwidthKbps} kbps` : session.stream?.protocol || "Direct"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="plexEmpty">{plexPlayback?.configured ? (plexPlayback?.reachable ? "Plex server is reachable with no active playback." : "Plex token is configured, but the server is not reachable.") : "Plex server sessions need a local Plex token."}</div>
                  )}
                </article>
              )}

              <article className="card batteryCard">
                <div className="batteryTop"><div className={`batteryIcon ${telemetry?.battery.available === false ? "unavailable" : ""}`}><span style={{ width: `${telemetry?.battery.available === false ? 0 : telemetry?.battery.percent || 0}%` }} /></div><div><b>{telemetry?.battery.available === false ? "AC" : `${telemetry?.battery.percent || 0}%`}</b><span>{telemetry ? (telemetry.battery.available === false ? "Desktop power · no battery sensor" : `${telemetry.battery.state} · ${remaining(telemetry.battery.timeRemainingMinutes)}`) : "Waiting for companion"}</span></div></div>
                <div className="batteryFacts"><div><span>Condition</span><b>{telemetry?.battery.available === false ? "Not applicable" : telemetry?.battery.condition || "—"}</b></div><div><span>Cycle count</span><b>{telemetry?.battery.available === false ? "—" : telemetry?.battery.cycleCount || 0}</b></div><div><span>Capacity</span><b>{telemetry?.battery.available === false ? "—" : `${telemetry?.battery.healthPercent || 0}%`}</b></div></div>
              </article>
            </div>
          </section>

          <section className="history card">
            <div><p className="label">LIVE CPU HISTORY</p><h2>Resource activity</h2><span className="historyMeta">Last {Math.max(1, Math.round(cpuHistory.length * refreshInterval / 1000))} sec · {refreshInterval / 1000}s refresh</span></div>
            <div className="historyBars" aria-hidden="true">{cpuHistory.map((height, index) => <i key={index} style={{ height: `${Math.max(2, height)}%` }} />)}</div>
            <div className="historySummary"><b>{cpu.toFixed(1)}%</b><span>current load</span><b>{cpuAverage.toFixed(1)}%</b><span>window average</span></div>
          </section>

          <section className="statusGrid" aria-label="System diagnostics">
            <article className="statusCard card"><p className="label">TELEMETRY QUALITY</p><h2>{transport === "relay" ? "Encrypted relay" : transport === "direct" ? "Direct local" : "Waiting for feed"}</h2><span>{sampleAgeSeconds === null ? "No sample received" : `${sampleAgeSeconds}s sample age · ${refreshInterval / 1000}s cadence`}</span></article>
            <article className="statusCard card"><p className="label">MEMORY HEADROOM</p><h2>{telemetry ? `${gb(telemetry.memory.freeBytes)} GB free` : "—"}</h2><span>{telemetry ? `${freeMemoryPercent.toFixed(0)}% available · ${telemetry.memory.pressure} pressure` : "Waiting for companion"}</span></article>
            <article className="statusCard card"><p className="label">NETWORK IDENTITY</p><h2>{telemetry?.network.address || "Unavailable"}</h2><span>{telemetry?.network.interface || "No interface"} · live traffic sampled</span></article>
          </section>

          {/*
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
                    <option value="mac">Local companion</option>
                    <option value="iperf3">Public iPerf3 server</option>
                    <option value="custom">Custom endpoint</option>
                  </select>
                </label>
                {speedServer === "iperf3" && (
                  <>
                    <label className="speedServerSelect iperfServerSelect">
                      <span>iPerf3</span>
                      <select value={iperf3ServerId} onChange={(event) => setIperf3ServerId(event.target.value)} aria-label="Public iPerf3 server">
                        <optgroup label="United States">
                          {iperf3Servers.filter((server) => server.country === "US").map((server) => <option key={server.id} value={server.id}>{server.city} · {server.provider}</option>)}
                        </optgroup>
                        <optgroup label="Canada">
                          {iperf3Servers.filter((server) => server.country === "CA").map((server) => <option key={server.id} value={server.id}>{server.city} · {server.provider}</option>)}
                        </optgroup>
                      </select>
                    </label>
                    <span className={`iperf3Status ${iperf3Status}`}>{iperf3Message}</span>
                  </>
                )}
                {speedServer === "custom" && (
                  <label className="speedCustomField">
                    <input className="speedCustomInput" value={customSpeedServer} onChange={(event) => setCustomSpeedServer(event.target.value)} placeholder="server.example or https://server.example/speed-test" aria-label="Custom speed-test endpoint URL" />
                    <span>{speedServerHelp(customSpeedServer)}</span>
                  </label>
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
              <small>{speedServer === "iperf3" ? "Runs from this machine with native iPerf3 against the selected public server. Remote control is intentionally disabled for now." : "Runs about 25 seconds. Custom servers must expose the Pulseboard speed-test API with browser access enabled."}</small>
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
          */}
          <footer><span>Pulseboard · Real telemetry · {transport === "relay" ? "Encrypted relay" : transport === "direct" ? "Direct local" : "Disconnected"}</span><span>{telemetry ? `${telemetry.device.os} · ${telemetry.device.model}` : "Waiting for companion"}</span></footer>
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
              <div><b>Selected companion</b><span>Runs quietly in the background and securely relays metrics from each registered machine.</span></div>
              <div className={`connectionPill ${status}`}><i />{status === "live" ? (transport === "relay" ? "Relay connected" : "Direct connected") : status === "connecting" ? "Connecting" : "Offline"}</div>
              <button className="settingsAction" onClick={() => { setStatus("connecting"); void fetchTelemetry(); }}>Reconnect now</button>
            </div>
            <div className="privacyNote"><Mark>⌁</Mark><div><b>Private by design</b><span>Direct viewing stays on the local machine. Remote viewing uses an authenticated encrypted relay that keeps only the newest telemetry snapshot per client.</span></div></div>
            <div className="settingsFooter"><span>Current connection</span><code>{transport === "relay" ? "Encrypted cloud relay" : transport === "direct" ? "127.0.0.1:4319" : "Not connected"}</code></div>
          </section>
        </div>
      )}

      {addMachineOpen && (
        <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddMachineOpen(false); }}>
          <section className="settingsPanel addMachinePanel" role="dialog" aria-modal="true" aria-labelledby="add-machine-title">
            <div className="settingsHeader"><div><p className="eyebrow">PULSEBOARD FLEET</p><h2 id="add-machine-title">Add Fedora machine</h2></div><button className="closeButton" aria-label="Close add machine" onClick={() => setAddMachineOpen(false)}>×</button></div>
            <div className="settingGroup">
              <div><b>Linux companion</b><span>Run the companion on Fedora with the same relay credentials. Once it sends a sample, the third fleet slot becomes a live machine tile.</span></div>
            </div>
            <pre className="setupCommand">{`git clone https://github.com/tcullum/pulseboard.git
cd pulseboard
npm install
PULSEBOARD_RELAY_TOKEN="your-device-token" \\
PULSEBOARD_SIWC_TOKEN="your-sites-token" \\
npm run telemetry:install:linux`}</pre>
            <div className="privacyNote"><Mark>⌁</Mark><div><b>Relay credentials stay local</b><span>The dashboard never exposes relay tokens. Put them only in the Fedora shell or local companion config.</span></div></div>
          </section>
        </div>
      )}
    </main>
  );
}
