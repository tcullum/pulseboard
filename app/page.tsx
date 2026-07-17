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

const COMPANION_URL = "http://127.0.0.1:4319/telemetry";
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
  }, []);

  useEffect(() => {
    window.localStorage.setItem("pulseboard-refresh", String(refreshInterval));
  }, [refreshInterval]);

  useEffect(() => {
    window.localStorage.setItem("pulseboard-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
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
  const download = rate(telemetry?.network.downloadBytesPerSecond);
  const upload = rate(telemetry?.network.uploadBytesPerSecond);
  const memoryUsedPercent = telemetry ? telemetry.memory.usedBytes / telemetry.memory.totalBytes * 100 : 0;
  const wiredPercent = telemetry ? telemetry.memory.wiredBytes / telemetry.memory.totalBytes * 100 : 0;
  const compressedPercent = telemetry ? telemetry.memory.compressedBytes / telemetry.memory.totalBytes * 100 : 0;
  const appPercent = Math.max(0, memoryUsedPercent - wiredPercent - compressedPercent);
  const isHealthy = status === "live" && telemetry?.thermal.status === "Normal" && telemetry.memory.pressure !== "High";

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
