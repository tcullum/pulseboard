# Self-hosting Pulseboard

Pulseboard can run locally in Docker with persistent D1-compatible storage.

1. Create `.env.docker` from `.env.docker.example` and set unique credentials.
2. Run `docker compose up -d --build`.
3. Open `http://localhost:4320` or the host's LAN/Tailscale address on port 4320.
4. Point each companion's `relayUrl` at the reachable local address and set its `deviceToken` to `TELEMETRY_TOKEN`.

The container requires HTTP Basic authentication. Docker control commands are still executed by the Windows companion, so the container does not mount the Docker socket.

Local state is stored in the `pulseboard-data` Docker volume. The OpenAI Sites deployment is independent and can remain available as a fallback.
