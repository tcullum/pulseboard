const username = process.env.PULSEBOARD_LOCAL_USERNAME || "thomas";
const password = process.env.PULSEBOARD_LOCAL_PASSWORD || "";
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

try {
  const response = await fetch("http://127.0.0.1:3000/", { headers: { Authorization: authorization } });
  if (!response.ok) process.exit(1);
} catch {
  process.exit(1);
}
