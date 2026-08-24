# Pulseboard

Pulseboard is a private, cross-platform system dashboard for monitoring a small fleet of macOS, Windows, and Linux computers from one place.

Its local companions report live system health, storage, processes, and network data. Windows adds Plex activity and playback details; Windows and Linux add Docker container health and authenticated start, stop, and restart controls.

## Features

- Fleet overview for macOS, Windows 11, and Fedora/Linux
- Live CPU, memory, storage, battery, thermal, process, and network telemetry
- Plex process and playback monitoring on Windows
- Docker health and container controls on Windows and Linux
- Authenticated telemetry relay and command queue
- OpenAI Sites deployment or self-hosted Docker deployment
- Persistent D1-compatible storage when self-hosted

## Requirements

- Node.js `>=22.13.0`
- Docker and Docker Compose for self-hosting

## Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run build
npm test
npm run lint
```

## Self-hosting

Copy the example environment file and replace every placeholder with unique credentials:

```bash
cp .env.docker.example .env.docker
docker compose up -d --build
```

Open `http://localhost:4320`, or use the Docker host's LAN or Tailscale address on port `4320`. Point each companion's `relayUrl` at that address and use `TELEMETRY_TOKEN` as its `deviceToken`.

The container uses HTTP Basic authentication and stores local state in the `pulseboard-data` Docker volume. It does not mount the Docker socket: Docker commands are validated and executed by the companion running on the monitored Windows or Linux machine.

See [SELF_HOSTING.md](SELF_HOSTING.md) for the concise deployment checklist.

## Companion installation

The companion reads relay credentials from its platform-specific `relay.json` file and installs as a background service.

### Windows

```powershell
$env:PULSEBOARD_RELAY_TOKEN = "your-device-token"
$env:PULSEBOARD_SIWC_TOKEN = "your-sites-token"
$env:PLEX_URL = "http://127.0.0.1:32400"
$env:PLEX_TOKEN = "your-plex-token"
npm run telemetry:install:windows
```

Plex settings are optional. The token stays in the local companion configuration and is used only for requests to the Plex server.

### macOS

```bash
PULSEBOARD_RELAY_TOKEN="your-device-token" \
PULSEBOARD_SIWC_TOKEN="your-sites-token" \
npm run telemetry:install:mac
```

### Linux/Fedora

```bash
PULSEBOARD_RELAY_TOKEN="your-device-token" \
PULSEBOARD_SIWC_TOKEN="your-sites-token" \
npm run telemetry:install:linux
```

For a self-hosted deployment, create or update `relay.json` with the local `relayUrl` and `deviceToken` before running the installer. The configuration locations are:

- Windows: `%APPDATA%\Pulseboard\relay.json`
- macOS: `~/Library/Application Support/Pulseboard/relay.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/Pulseboard/relay.json`

## Architecture

The dashboard is built with vinext, React, and Cloudflare's Worker-compatible runtime. Hosted deployments use OpenAI Sites with Cloudflare D1. Self-hosted deployments run the same application through Wrangler in Docker with persistent local storage.

Telemetry and secrets are deliberately separated: companions collect machine-local data and keep Plex credentials locally, while the dashboard stores telemetry samples and queues tightly validated Docker actions.
