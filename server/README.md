# Chess Arena game server

The online half of Chess Arena: players find each other with **6-letter invite codes** or **quick match**, and the server runs every game — it checks each move, owns both clocks and decides every result. The app only sends move requests and shows what the server says.

- One small Node.js process, all state in memory, **no database and no accounts**.
- Speaks a JSON protocol over a WebSocket at `/ws` (defined in [`src/shared/protocol.ts`](../src/shared/protocol.ts), shared with the app).
- Reuses the app's chess rules ([`src/game/rules.ts`](../src/game/rules.ts)), so both sides agree on every result.

## Run it locally

Requires Node.js 20+.

```sh
cd server
npm install
npm run dev            # builds and starts on http://localhost:8080
curl localhost:8080/health
```

From the repository root you can also use `npm run server:dev` and `npm run server:test`.

## Configuration

All settings are environment variables; the defaults suit a single small server.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to listen on |
| `MIN_APP_VERSION` | `0.9.0` | Older apps are asked to update before playing online |
| `MAINTENANCE_MESSAGE` | – | When set, new connections are refused with this message |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy (Render, Caddy, Cloudflare Tunnel) so per-IP limits use the real client address |
| `ID_SECRET` | random | Secret for deriving the player ids opponents see. Set it so they stay stable across restarts |
| `SHUTDOWN_GRACE_MS` | `25000` | On shutdown, how long to wait for live games to finish |
| `MAX_CONNECTIONS_PER_IP` | `10` | Connection limit per IP address |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent` |

## Endpoints

| Path | |
|---|---|
| `GET /health` | `{"status":"ok", "liveGames":…, "connections":…, …}` — use it for uptime checks. Returns 503 while shutting down |
| `/ws` | The WebSocket the app connects to |

## How games work

- **Rooms:** a player creates a game and gets a code like `K7QM2X` (no look-alike characters). It expires after 10 minutes, or a minute after the host disconnects. Joining is case-insensitive and ignores spaces and dashes.
- **Quick match:** pools for 3+2, 5+3, 10+0 and 15+10; you're paired the moment someone else is waiting in the same pool.
- **Clocks:** start after White's first move; the server deducts thinking time, adds the increment and credits up to 500 ms of measured network lag per move. Only the server decides a timeout (a draw if the other side can't mate). A side that doesn't make its first move within 30 seconds aborts the game.
- **Disconnects:** the opponent sees a 60-second countdown. Coming back in time (`game.rejoin` with the per-game token) restores everything; otherwise the absent player loses by abandonment (the game is aborted if fewer than two moves were played or both players left).
- **Also:** resign, draw offers (one per player every 10 moves), abort before both sides have moved, rematch with colours swapped.
- **Safety:** every message is validated and capped at 4 KB; 20 messages/s per connection; 5 new rooms a minute; a connection that keeps sending junk is closed. Display names are trimmed to 20 characters and filtered. Opponents never see each other's install id. Nothing is written to disk; logs contain ids and counts, not names.
- **Restarts end live games** (players are told "the server restarted"; no result is recorded). Finished games are kept for 10 minutes so players can see the result and rematch.

## Tests

```sh
npm test         # unit, WebSocket integration and the soak test (~20 s)
npm run soak     # just the soak test: 100 concurrent games of random moves
npm run typecheck
```

## Hosting

Any machine that runs Docker or Node.js 20+ and stays on can host the server. The app connects to `wss://<your-host>/ws`, so the server needs **HTTPS**: put it behind a proxy or tunnel that provides a certificate. Pick one:

### 1. Render (managed, simplest)

[`render.yaml`](../render.yaml) describes the service. In Render: **New → Blueprint →** pick this repository. It builds `server/Dockerfile`, checks `/health` and sets `TRUST_PROXY` and a generated `ID_SECRET`. The free plan sleeps when idle (the first connection then takes about a minute); the Starter plan (~$7/month) stays on.

### 2. Your own computer or a Raspberry Pi, with Cloudflare Tunnel (free)

The tunnel gives you a public `https://` address **without opening ports on your router or revealing your home IP**. You need a free Cloudflare account and a domain on Cloudflare (or a temporary `trycloudflare.com` address for testing).

```sh
# 1. Run the server
docker build -f server/Dockerfile -t chess-arena-server .     # from the repository root
docker run -d --restart unless-stopped --name chess-arena \
  -e TRUST_PROXY=1 -e ID_SECRET=<a long random string> -p 127.0.0.1:8080:8080 chess-arena-server

# 2. Quick test: a temporary public URL
cloudflared tunnel --url http://localhost:8080

# 3. Permanent: a named tunnel on your domain (e.g. chess.example.com)
cloudflared tunnel login
cloudflared tunnel create chess-arena
cloudflared tunnel route dns chess-arena chess.example.com
cloudflared tunnel run --url http://localhost:8080 chess-arena
```

The computer must stay on and awake while people play.

### 3. A rented server (VPS, ~$4–6/month)

Run the same Docker container, and put [Caddy](https://caddyserver.com/) in front for automatic HTTPS:

```
chess.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

### 4. Router port forwarding (not recommended)

Possible with dynamic DNS and Caddy on your own machine, but it exposes your home IP address and needs router changes. Prefer option 2.

## Running it

- **Deploy / update:** rebuild and restart the container (or let Render redeploy). On `SIGTERM` the server stops accepting new games, waits up to `SHUTDOWN_GRACE_MS` for live ones, then ends the rest.
- **Rollback:** redeploy the previous image or commit.
- **Maintenance:** set `MAINTENANCE_MESSAGE` and restart; the app shows the message.
- **Protocol changes:** bump `PROTOCOL_VERSION` in `src/shared/protocol.ts` and `MIN_APP_VERSION`, and release the app first.
- **Monitoring:** point an uptime checker (e.g. UptimeRobot, Better Stack) at `/health`. Logs are JSON lines on stdout/stderr.
