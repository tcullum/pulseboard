"use client";

import { useEffect, useMemo, useState } from "react";

type Process = {
  name: string;
  detail: string;
  pid: string;
  cpu: number;
  memory: number;
  energy: "Low" | "Medium" | "High";
  color: string;
};

const baseProcesses: Process[] = [
  { name: "WindowServer", detail: "System", pid: "412", cpu: 12.8, memory: 1.2, energy: "Medium", color: "#8799ff" },
  { name: "Arc", detail: "12 tabs", pid: "884", cpu: 8.6, memory: 2.8, energy: "High", color: "#f3a95f" },
  { name: "Codex", detail: "Workspace", pid: "5192", cpu: 6.2, memory: 1.6, energy: "Medium", color: "#5ee6a8" },
  { name: "Figma", detail: "Desktop", pid: "2104", cpu: 4.1, memory: 1.1, energy: "Low", color: "#df74e8" },
  { name: "kernel_task", detail: "System", pid: "0", cpu: 2.7, memory: 0.8, energy: "Low", color: "#5dbedf" },
  { name: "Spotify", detail: "Playing", pid: "1486", cpu: 1.9, memory: 0.5, energy: "Low", color: "#55d779" },
];

const cpuBars = [34, 42, 38, 46, 51, 44, 58, 61, 49, 55, 48, 64, 59, 66, 52, 47, 56, 63, 68, 57, 53, 62, 58, 67, 60, 54, 64, 71, 66, 62, 57, 69, 65, 72, 63, 60];

function Mark({ children }: { children: React.ReactNode }) {
  return <span className="mark" aria-hidden="true">{children}</span>;
}

export default function Home() {
  const [tick, setTick] = useState(0);
  const [sort, setSort] = useState<"cpu" | "memory">("cpu");
  const [range, setRange] = useState<"1H" | "6H" | "24H">("1H");
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 2200);
    return () => window.clearInterval(id);
  }, [paused]);

  const cpu = 38 + ((tick * 7) % 9) - 4;
  const temp = 54 + ((tick * 3) % 5) - 2;
  const processes = useMemo(
    () => [...baseProcesses].sort((a, b) => b[sort] - a[sort]),
    [sort],
  );

  return (
    <main className="shell">
      <aside className="rail" aria-label="System views">
        <div className="brand" aria-label="Pulseboard">P</div>
        <nav>
          <button className="railButton active" aria-label="Overview"><Mark>⌁</Mark><span>Overview</span></button>
          <button className="railButton" aria-label="Performance"><Mark>⌇</Mark><span>Performance</span></button>
          <button className="railButton" aria-label="Storage"><Mark>◫</Mark><span>Storage</span></button>
          <button className="railButton" aria-label="Network"><Mark>↗</Mark><span>Network</span></button>
          <button className="railButton" aria-label="Processes"><Mark>≡</Mark><span>Processes</span></button>
        </nav>
        <div className="railBottom">
          <button className="railButton" aria-label="Settings"><Mark>⚙</Mark><span>Settings</span></button>
          <div className="avatar">TC</div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="deviceLockup">
            <div className="deviceIcon" aria-hidden="true"><span /></div>
            <div><p>Thomas&apos;s MacBook Pro</p><span>14-inch · Apple M3 Max · 36 GB</span></div>
          </div>
          <div className="topActions">
            <div className="health"><i /> All systems normal</div>
            <button className="iconButton" aria-label="Search">⌕</button>
            <button className="iconButton notification" aria-label="Notifications">●</button>
            <button className="pauseButton" onClick={() => setPaused((value) => !value)}>{paused ? "Resume live" : "Pause live"}</button>
          </div>
        </header>

        <div className="content">
          <section className="headingRow">
            <div><p className="eyebrow">SYSTEM OVERVIEW</p><h1>Your Mac is running smoothly.</h1><p className="subhead">Live performance and health, at a glance.</p></div>
            <div className="updated"><span className={paused ? "dot paused" : "dot"} />{paused ? "Telemetry paused" : "Live · updated just now"}</div>
          </section>

          <section className="metricsGrid">
            <article className="card cpuCard">
              <div className="cardHeader"><div><p className="label">CPU LOAD</p><div className="bigValue">{cpu}<span>%</span></div></div><div className="delta good">↓ 6.4%</div></div>
              <div className="chart" aria-label={`CPU load ${cpu} percent`}>
                {cpuBars.map((bar, index) => <i key={index} style={{ height: `${Math.max(15, bar + ((tick + index) % 4) - 2)}%` }} />)}
              </div>
              <div className="cardFooter"><span>8 performance cores</span><span>12 efficiency cores</span></div>
            </article>

            <article className="card memoryCard">
              <div className="cardHeader"><div><p className="label">MEMORY</p><div className="bigValue">18.2<span> GB</span></div></div><span className="quiet">of 36 GB</span></div>
              <div className="memoryBar"><i /><b /><em /></div>
              <div className="memoryLegend">
                <span><i className="cyan" />Apps <b>10.4 GB</b></span>
                <span><i className="violet" />Wired <b>4.9 GB</b></span>
                <span><i className="blue" />Cached <b>2.9 GB</b></span>
              </div>
              <div className="pressure"><span>Memory pressure</span><b>Low</b></div>
            </article>

            <article className="card thermalCard">
              <div className="cardHeader"><div><p className="label">THERMALS</p><div className="bigValue">{temp}<span>°C</span></div></div><div className="thermalGlyph">°</div></div>
              <div className="thermalScale"><span /><i style={{ left: `${48 + tick % 5}%` }} /></div>
              <div className="thermalLabels"><span>Cool</span><span>Warm</span><span>Hot</span></div>
              <div className="fanRow"><span>Fan speed</span><b>1,240 <small>RPM</small></b></div>
            </article>
          </section>

          <section className="quickGrid">
            <article className="miniCard"><Mark>↑↓</Mark><div><p>NETWORK</p><b>{(2.4 + (tick % 4) * 0.1).toFixed(1)} <small>MB/s</small></b><span>↓ Download</span></div><div className="miniStat"><b>482 <small>KB/s</small></b><span>↑ Upload</span></div></article>
            <article className="miniCard"><Mark>◷</Mark><div><p>UPTIME</p><b>3d 14h</b><span>Since Mon, 9:42 AM</span></div></article>
            <article className="miniCard"><Mark>▤</Mark><div><p>PROCESSES</p><b>428</b><span>12 running</span></div><div className="miniStat"><b>2,184</b><span>Threads</span></div></article>
            <article className="miniCard"><Mark>⌁</Mark><div><p>POWER DRAW</p><b>18.4 <small>W</small></b><span>On power adapter</span></div><span className="stable">Stable</span></article>
          </section>

          <section className="lowerGrid">
            <article className="card processCard">
              <div className="sectionHeader"><div><p className="label">TOP PROCESSES</p><h2>What&apos;s using your Mac</h2></div><div className="segmented"><button className={sort === "cpu" ? "selected" : ""} onClick={() => setSort("cpu")}>CPU</button><button className={sort === "memory" ? "selected" : ""} onClick={() => setSort("memory")}>Memory</button></div></div>
              <div className="processTable">
                <div className="tableHead"><span>PROCESS</span><span>PID</span><span>CPU</span><span>MEMORY</span><span>ENERGY</span></div>
                {processes.slice(0, 5).map((process) => (
                  <div className="processRow" key={process.name}>
                    <span className="processName"><i style={{ background: process.color }}>{process.name.slice(0, 1)}</i><span><b>{process.name}</b><small>{process.detail}</small></span></span>
                    <span>{process.pid}</span><span><b>{process.cpu.toFixed(1)}%</b></span><span>{process.memory.toFixed(1)} GB</span><span className={`energy ${process.energy.toLowerCase()}`}>{process.energy}</span>
                  </div>
                ))}
              </div>
              <button className="viewAll">View all processes <span>→</span></button>
            </article>

            <div className="sideStack">
              <article className="card storageCard">
                <div className="cardHeader"><div><p className="label">STORAGE</p><h2>Macintosh HD</h2></div><Mark>•••</Mark></div>
                <div className="storageLead"><b>184 GB</b><span>free of 494 GB</span></div>
                <div className="storageBar"><i /><b /><em /><span /></div>
                <div className="storageLegend"><span><i className="apps" />Apps <b>126 GB</b></span><span><i className="docs" />Documents <b>88 GB</b></span><span><i className="system" />System <b>61 GB</b></span><span><i className="other" />Other <b>35 GB</b></span></div>
              </article>

              <article className="card batteryCard">
                <div className="batteryTop"><div className="batteryIcon"><span style={{ width: "82%" }} /></div><div><b>82%</b><span>Charging · 38 min to full</span></div></div>
                <div className="batteryFacts"><div><span>Condition</span><b>Normal</b></div><div><span>Cycle count</span><b>147</b></div><div><span>Capacity</span><b>96%</b></div></div>
              </article>
            </div>
          </section>

          <section className="history card">
            <div><p className="label">PERFORMANCE HISTORY</p><h2>Resource activity</h2></div>
            <div className="historyBars" aria-hidden="true">{[32,38,42,39,47,44,51,56,48,62,57,66,61,53,59,71,63,68,60,74,69,65,72,64,70,76,68,73,67,79,72,75,69,77,74,82].map((height, i) => <i key={i} style={{height: `${height}%`}} />)}</div>
            <div className="rangeControl">{(["1H", "6H", "24H"] as const).map((item) => <button key={item} className={range === item ? "selected" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
          </section>
          <footer><span>Pulseboard · Local preview data</span><span>macOS 15.5 · Last full scan 4 min ago</span></footer>
        </div>
      </section>
    </main>
  );
}
