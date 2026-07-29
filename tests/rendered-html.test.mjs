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

test("hides unavailable thermal hardware on the Windows Plex client", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(page, /showThermalCard = activePlatform !== "windows" && telemetry\?\.thermal\.available !== false/);
  assert.match(page, /\{showThermalCard && \(/);
  assert.match(page, /withoutThermal/);
  assert.match(css, /\.metricsGrid\.withoutThermal/);
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

test("surfaces Docker health and controls on Windows and Fedora dashboards", async () => {
  const [page, css, companion, controlRoute, controlDb] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("companion/pulseboard-telemetry.mjs", root), "utf8"),
    readFile(new URL("app/api/docker-control/route.ts", root), "utf8"),
    readFile(new URL("db/docker-control.ts", root), "utf8"),
  ]);

  assert.match(companion, /function dockerStats/);
  assert.match(companion, /dockerBinary/);
  assert.match(companion, /HealthStatus/);
  assert.match(companion, /"ps", "-a", "--format", "\{\{json \.\}\}"/);
  assert.doesNotMatch(companion, /itemScore\(a\) - itemScore\(b\)\)\.slice\(0, 5\)/);
  assert.match(companion, /if \(!isWindows && !isLinux\) return ""/);
  assert.match(companion, /"\/usr\/bin\/docker"/);
  assert.match(page, /showDockerCard = activePlatform === "windows" \|\| activePlatform === "linux"/);
  assert.match(page, /dockerClientName = activePlatform === "linux" \? "Fedora client"/);
  assert.match(page, /DOCKER HEALTH/);
  assert.match(page, /All \$\{dockerHealth\?\.total/);
  assert.match(page, /runDockerAction\(container\.name, "start"\)/);
  assert.match(page, /runDockerAction\(container\.name, "stop"\)/);
  assert.match(page, /runDockerAction\(container\.name, "restart"\)/);
  assert.ok(page.indexOf('id="plex"') < page.indexOf('id="docker"'));
  assert.match(css, /\.dockerCard/);
  assert.match(css, /\.dockerStats/);
  assert.match(css, /\.dockerContainers \{ max-height:520px;/);
  assert.match(css, /\.dockerActions button/);
  assert.match(companion, /processDockerCommand/);
  assert.match(companion, /if \(!isWindows && !isLinux\) return false/);
  assert.match(companion, /execFileSync\(binary, \[action, containerName\]/);
  assert.match(controlRoute, /Authentication required/);
  assert.match(controlRoute, /ACTIONS = new Set<DockerAction>/);
  assert.match(controlDb, /CREATE TABLE IF NOT EXISTS docker_commands/);
});

test("renders a three-slot fleet dashboard above machine details", async () => {
  const [page, css, packageJson, linuxInstaller, linuxUninstaller, companion, route] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("companion/install-linux.sh", root), "utf8"),
    readFile(new URL("companion/uninstall-linux.sh", root), "utf8"),
    readFile(new URL("companion/pulseboard-telemetry.mjs", root), "utf8"),
    readFile(new URL("app/api/telemetry/route.ts", root), "utf8"),
  ]);

  assert.match(page, /Pulseboard fleet/);
  assert.match(page, /fleetSnapshots/);
  assert.match(page, /fleetPlaceholders/);
  assert.match(page, /up to 3 dashboard slots/);
  assert.match(page, /SELECTED MACHINE/);
  assert.match(page, /Add Fedora machine/);
  assert.match(page, /Linux Dell Fedora/);
  assert.match(page, /isLinuxDellFedora/);
  assert.match(route, /model: telemetry\.device\?\.model/);
  assert.match(page, /platform === "linux"/);
  assert.match(css, /\.addMachinePanel/);
  assert.match(css, /\.setupCommand/);
  assert.match(css, /\.fleetGrid/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.addMachine/);
  assert.match(packageJson, /telemetry:install:linux/);
  assert.match(packageJson, /telemetry:uninstall:linux/);
  assert.match(linuxInstaller, /systemctl --user/);
  assert.match(linuxInstaller, /com\.pulseboard\.telemetry\.service/);
  assert.match(linuxUninstaller, /systemctl --user disable --now/);
  assert.match(companion, /isLinux/);
  assert.match(companion, /linuxDevice/);
  assert.match(companion, /\/proc\/meminfo/);
  assert.match(companion, /\/proc\/net\/dev/);
});

test("provides a private three-client feed for the macOS menu bar utility", async () => {
  const [route, app, model, packageManifest, installer, launchAgent] = await Promise.all([
    readFile(new URL("app/api/fleet-status/route.ts", root), "utf8"),
    readFile(new URL("macos/PulseboardStatus/Sources/PulseboardStatus/PulseboardStatusApp.swift", root), "utf8"),
    readFile(new URL("macos/PulseboardStatus/Sources/PulseboardStatus/StatusModel.swift", root), "utf8"),
    readFile(new URL("macos/PulseboardStatus/Package.swift", root), "utf8"),
    readFile(new URL("macos/PulseboardStatus/install-app.sh", root), "utf8"),
    readFile(new URL("macos/PulseboardStatus/com.pulseboard.status.plist", root), "utf8"),
  ]);

  assert.match(route, /PULSEBOARD_STATUS_TOKEN/);
  assert.match(route, /statusForAge/);
  assert.match(route, /Thomas's MacBook Pro/);
  assert.match(route, /Windows Plex/);
  assert.match(route, /Linux Dell Fedora/);
  assert.match(route, /Cache-Control.*no-store/s);
  assert.match(app, /MenuBarExtra/);
  assert.match(app, /Starts at Login/);
  assert.match(model, /Task\.sleep\(for: \.seconds\(15\)\)/);
  assert.match(model, /OAI-Sites-Authorization/);
  assert.match(model, /com\.pulseboard\.status/);
  assert.match(packageManifest, /\.macOS\(\.v14\)/);
  assert.match(installer, /launchctl bootstrap/);
  assert.match(launchAgent, /RunAtLoad/);
});
