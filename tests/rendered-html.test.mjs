import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("recovers telemetry when a suspended mobile tab resumes", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /addEventListener\("pageshow"/);
  assert.match(page, /addEventListener\("visibilitychange"/);
  assert.match(page, /addEventListener\("online"/);
  assert.match(page, /addEventListener\("offline"/);
  assert.match(page, /fetchInFlight\.current/);
  assert.match(page, /refreshFleetSnapshots/);
  assert.match(page, /cache: "no-store"/);
});

test("detects missing styles and prevents stale application shells", async () => {
  const [page, css, worker] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("worker/index.ts", root), "utf8"),
  ]);

  assert.match(css, /--pulseboard-ready:\s*1/);
  assert.match(page, /getPropertyValue\("--pulseboard-ready"\)/);
  assert.match(page, /pulseboard-style-recovery/);
  assert.match(page, /window\.location\.replace/);
  assert.match(worker, /contentType\.includes\("text\/html"\)/);
  assert.match(worker, /no-cache, no-store, max-age=0, must-revalidate/);
});

test("keeps the dashboard focused on trustworthy telemetry", async () => {
  const [page, companion] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("companion/pulseboard-telemetry.mjs", root), "utf8"),
  ]);

  const visiblePage = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.doesNotMatch(visiblePage, /Connection speed test/);
  assert.doesNotMatch(visiblePage, /id="tools"/);
  assert.match(visiblePage, /TELEMETRY QUALITY/);
  assert.match(visiblePage, /MEMORY HEADROOM/);
  assert.match(visiblePage, /NETWORK IDENTITY/);
  assert.match(visiblePage, /sample age/);
  assert.match(visiblePage, /relay\.stale/);
  assert.match(visiblePage, /available === false/);
  assert.match(companion, /loadAverage/);
  assert.match(companion, /Win32_PerfFormattedData_PerfProc_Process/);
  assert.match(companion, /thermalStats/);
});

test("surfaces Plex playback stream telemetry", async () => {
  const [page, companion, windowsInstaller, macInstaller] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("companion/pulseboard-telemetry.mjs", root), "utf8"),
    readFile(new URL("companion/install-windows.ps1", root), "utf8"),
    readFile(new URL("companion/install.sh", root), "utf8"),
  ]);

  assert.match(companion, /plexPlaybackTelemetry/);
  assert.match(companion, /\/status\/sessions/);
  assert.match(companion, /PlexOnlineToken/);
  assert.match(companion, /HKCU:\\\\Software\\\\Plex, Inc\.\\\\Plex Media Server/);
  assert.match(companion, /X-Plex-Token/);
  assert.match(companion, /TranscodeSession/);
  assert.match(page, /plexNowPlaying/);
  assert.match(page, /showPlexCard = activePlatform === "windows"/);
  assert.match(page, /transcodeSessions/);
  assert.match(page, /bandwidthKbps/);
  assert.match(windowsInstaller, /PLEX_TOKEN/);
  assert.match(macInstaller, /PLEX_TOKEN/);
});

test("renders a three-slot fleet dashboard above machine details", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(page, /Pulseboard fleet/);
  assert.match(page, /fleetSnapshots/);
  assert.match(page, /fleetPlaceholders/);
  assert.match(page, /up to 3 dashboard slots/);
  assert.match(page, /SELECTED MACHINE/);
  assert.match(css, /\.fleetGrid/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.addMachine/);
});
