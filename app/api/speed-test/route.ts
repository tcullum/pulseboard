export const dynamic = "force-dynamic";

const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "meta") {
    const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const clientIp = request.headers.get("cf-connecting-ip") || forwardedIp || "Local device";
    const edgeCode = request.headers.get("cf-ray")?.split("-")[1]?.toUpperCase();
    return Response.json({
      clientIp,
      service: "Pulseboard edge",
      location: edgeCode ? `${edgeCode} edge` : "Nearest service edge",
    }, { headers: noStoreHeaders });
  }

  if (url.searchParams.get("mode") === "ping") {
    return new Response("pulse", { headers: { ...noStoreHeaders, "Content-Type": "text/plain" } });
  }

  if (url.searchParams.get("mode") !== "download") {
    return Response.json({ error: "Unsupported test mode" }, { status: 400, headers: noStoreHeaders });
  }

  const requestedSize = Number(url.searchParams.get("size") || 0);
  const size = Math.min(Math.max(Math.round(requestedSize), 64 * 1024), MAX_DOWNLOAD_BYTES);
  const payload = new Uint8Array(size);
  for (let offset = 0; offset < payload.length; offset += 65_536) {
    crypto.getRandomValues(payload.subarray(offset, Math.min(offset + 65_536, payload.length)));
  }

  return new Response(payload, {
    headers: {
      ...noStoreHeaders,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "identity",
      "Content-Length": String(payload.byteLength),
    },
  });
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Upload sample is too large" }, { status: 413, headers: noStoreHeaders });
  }

  const payload = await request.arrayBuffer();
  if (payload.byteLength > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Upload sample is too large" }, { status: 413, headers: noStoreHeaders });
  }

  return Response.json({ receivedBytes: payload.byteLength }, { headers: noStoreHeaders });
}
