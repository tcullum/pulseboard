export const dynamic = "force-dynamic";

const MAX_TRANSFER_BYTES = 100 * 1024 * 1024;
const RANDOM_BUFFER_BYTES = 8 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;
const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
let randomSource: Uint8Array | null = null;

function getRandomSource() {
  if (randomSource) return randomSource;

  randomSource = new Uint8Array(RANDOM_BUFFER_BYTES);
  for (let offset = 0; offset < randomSource.length; offset += 65_536) {
    crypto.getRandomValues(randomSource.subarray(offset, Math.min(offset + 65_536, randomSource.length)));
  }
  return randomSource;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "meta") {
    const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const clientIp = request.headers.get("cf-connecting-ip") || forwardedIp || "Local device";
    const edgeCode = request.headers.get("cf-ray")?.split("-")[1]?.toUpperCase();
    const country = request.headers.get("cf-ipcountry") || "";
    return Response.json({
      clientIp,
      service: "Pulseboard edge",
      location: edgeCode ? `${edgeCode} edge` : "Nearest service edge",
      country,
    }, { headers: noStoreHeaders });
  }

  if (url.searchParams.get("mode") === "ping") {
    return new Response("pulse", { headers: { ...noStoreHeaders, "Content-Type": "text/plain" } });
  }

  if (url.searchParams.get("mode") !== "download") {
    return Response.json({ error: "Unsupported test mode" }, { status: 400, headers: noStoreHeaders });
  }

  const requestedSize = Number(url.searchParams.get("size") || 0);
  const size = Math.min(Math.max(Math.round(requestedSize), 64 * 1024), MAX_TRANSFER_BYTES);
  const source = getRandomSource();
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= size) {
        controller.close();
        return;
      }

      const offset = sent % source.length;
      const chunkSize = Math.min(size - sent, source.length - offset, STREAM_CHUNK_BYTES);
      controller.enqueue(source.subarray(offset, offset + chunkSize));
      sent += chunkSize;
    },
  });

  return new Response(stream, {
    headers: {
      ...noStoreHeaders,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "identity",
      "Content-Length": String(size),
    },
  });
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_TRANSFER_BYTES) {
    return Response.json({ error: "Upload sample is too large" }, { status: 413, headers: noStoreHeaders });
  }

  let received = 0;
  const reader = request.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_TRANSFER_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Upload sample is too large" }, { status: 413, headers: noStoreHeaders });
      }
    }
  }

  return Response.json({ received }, { headers: noStoreHeaders });
}
