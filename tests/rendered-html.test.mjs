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

test("includes a real, cancellable connection speed test", async () => {
  const [page, route, companion] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/speed-test/route.ts", root), "utf8"),
    readFile(new URL("companion/pulseboard-telemetry.mjs", root), "utf8"),
  ]);

  assert.match(page, /id="tools"/);
  assert.match(page, /Connection speed test/);
  assert.match(page, /Jitter/);
  assert.match(page, /Loaded/);
  assert.match(page, /SPEED_SCALE_MAX_MBPS\s*=\s*3000/);
  assert.match(page, /formatSpeed/);
  assert.match(page, /formatTick/);
  assert.match(page, /tickPosition/);
  assert.match(page, /Auto nearest edge/);
  assert.match(page, /This Mac companion/);
  assert.match(page, /Custom endpoint/);
  assert.match(page, /LOCAL_SPEED_TEST_URL/);
  assert.match(page, /speedTestUrl/);
  assert.match(page, /pulseboard-speed-unit/);
  assert.match(page, /pulseboard-speed-custom-url/);
  assert.match(page, /speedMeta/);
  assert.match(page, /SPEED_PHASE_MS/);
  assert.match(page, /SPEED_STREAMS/);
  assert.match(page, /response\.body\.getReader/);
  assert.match(page, /XMLHttpRequest/);
  assert.match(page, /trimmedMean/);
  assert.match(page, /speedTestController\.current\.abort/);
  assert.match(page, /performance\.now\(\)/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /mode"\) === "meta"/);
  assert.match(route, /cf-connecting-ip/);
  assert.match(route, /cf-ipcountry/);
  assert.match(route, /new ReadableStream/);
  assert.match(route, /getReader/);
  assert.match(route, /MAX_TRANSFER_BYTES/);
  assert.match(route, /crypto\.getRandomValues/);
  assert.match(companion, /\/speed-test/);
  assert.match(companion, /GET, POST, OPTIONS/);
  assert.match(companion, /Content-Encoding/);
  assert.match(companion, /request\.on\("data"/);
  assert.match(companion, /randomFillSync/);
});
