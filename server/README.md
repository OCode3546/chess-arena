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
| `MAINTENANCE_MESSAGE` | – | Start in maintenance mode with this message (see [Maintenance](#maintenance)) |
| `MAINTENANCE_FILE` | – | Path of a file that switches maintenance on while it exists; its text is the message. Checked every 5 s, no restart needed |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy (Render, Caddy, Cloudflare Tunnel) so per-IP limits use the real client address |
| `ID_SECRET` | random | Secret for deriving the player ids opponents see. Set it so they stay stable across restarts |
| `SHUTDOWN_GRACE_MS` | `25000` | On shutdown, how long to wait for live games to finish |
| `MAX_CONNECTIONS_PER_IP` | `10` | Connection limit per IP address |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent` |

## Endpoints

| Path | |
|---|---|
| `GET /health` | `{"status":"ok", "maintenance":false, "liveGames":…, "connections":…, …}` — use it for uptime checks. Returns 503 while shutting down |
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

## Runbook

### Production today

The public server is `wss://play.chessarena.dpdns.org/ws`, baked into release builds (`electron.vite.config.ts`). It runs on the maintainer's Mac as two Docker containers on the network `chess-arena-net`:

| Container | What it is |
|---|---|
| `chess-arena-server` | This server, image `chess-arena-server:latest`, port 8080 published on 127.0.0.1 only |
| `chess-arena-tunnel` | `cloudflared` running the named tunnel `chess-arena`, forwarding `play.chessarena.dpdns.org` to `chess-arena-server:8080` |

Settings and secrets live outside the repository in `~/.chess-arena/` (all `chmod 600`/`700`): `server.env` (`TRUST_PROXY=1`, `ID_SECRET`, `MIN_APP_VERSION`, `LOG_LEVEL`), `cloudflared/` (tunnel credentials and config) and `maintenance/`. Never commit these. The Mac must stay on and awake (System Settings → Energy: prevent automatic sleeping).

[`deploy.sh`](deploy.sh) does every routine job below.

### Deploy

```sh
git pull && npm ci --prefix server && npm test --prefix server   # tests first
server/deploy.sh deploy
```

It builds the image from the checkout, keeps the running one as `chess-arena-server:previous`, stops the old container (`SIGTERM`), starts the new one and waits for `/health`. The container runs read-only, without Linux capabilities, with memory/process limits and rotated logs.

### What happens to live games on a restart

All state is in memory. On `SIGTERM` the server stops accepting new rooms and matches (players get "The server is restarting"), waits up to `SHUTDOWN_GRACE_MS` (25 s) for live games to finish, then ends the rest with **no result** — both apps show "Server restarted — game ended" and record no XP. Invite codes and queues are lost; apps reconnect on their own. To avoid ending games, turn on maintenance first, wait until `/health` shows `"liveGames":0`, then deploy.

### Rollback

```sh
server/deploy.sh rollback
```

Swaps back to `chess-arena-server:previous` (the replaced image is kept as `:failed` for debugging). On Render: *Manual Deploy → Rollback* to the previous deploy.

### Maintenance

```sh
server/deploy.sh maintenance "Upgrading the server — back at 18:00"
server/deploy.sh maintenance off
```

Within 5 seconds: invite codes and queues close, idle players are disconnected and the app shows the message (it retries every 30 s); new players get the same message. Players in a live game can keep playing and rejoin until their game ends. On hosts without a writable file (Render), set `MAINTENANCE_MESSAGE` and redeploy instead.

### Protocol changes

Bump `PROTOCOL_VERSION` in `src/shared/protocol.ts`, release the new app first, then raise `MIN_APP_VERSION` in `~/.chess-arena/server.env` (and `render.yaml`) and redeploy. Older apps then show "Please update Chess Arena to play online" with a download button.

### Monitoring

- **Uptime:** the [Uptime workflow](../.github/workflows/uptime.yml) checks `/health` every 15 minutes; a failure turns red in GitHub Actions and emails the repository owner. Its run history is the uptime record. Docker's own health check runs every 30 s (`docker ps` shows `healthy`).
- **Status and errors:** `server/deploy.sh status` shows `/health`, the containers and the last day's warnings and errors.
- **Logs:** JSON lines; `info` on stdout, `warn`/`error` on stderr. A line with `"msg":"stats"` every 10 minutes records the counts. Crashes are logged as `"msg":"crash"` before the process exits and Docker restarts it. Logs contain game ids, room codes and counts — never names, guest ids or IP addresses (abusive connections are logged with a one-way `ipTag`). Rotated at 5 × 10 MB.

### Security checklist

- Only `wss://` through the tunnel; port 8080 is bound to 127.0.0.1, the home IP is never exposed and no router ports are open.
- `TRUST_PROXY=1` only behind a proxy that appends the client address to `X-Forwarded-For` (Cloudflare, Render, Caddy); otherwise per-IP limits can be bypassed.
- `ID_SECRET` is random and private; changing it only changes the public player ids.
- Dependencies: `npm audit --omit=dev --prefix server` must be clean before a deploy; keep `cloudflare/cloudflared` and `node:22-alpine` updated.
