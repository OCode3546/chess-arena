#!/usr/bin/env bash
# Self-hosted deployment of the game server (Docker + Cloudflare Tunnel), see server/README.md.
#
#   server/deploy.sh deploy                 build the image from this checkout and swap it in
#   server/deploy.sh rollback               go back to the image that ran before the last deploy
#   server/deploy.sh maintenance "<text>"   turn maintenance mode on (no restart)
#   server/deploy.sh maintenance off        turn it off
#   server/deploy.sh status                 /health, containers and recent warnings
#
# Secrets and settings stay outside the repository in $CHESS_ARENA_HOME (default ~/.chess-arena):
#   server.env                       TRUST_PROXY, ID_SECRET, MIN_APP_VERSION, LOG_LEVEL
#   maintenance/message.txt          present = maintenance mode (created by this script)
#   cloudflared/                     tunnel credentials and config (used by the tunnel container)
set -euo pipefail

HOME_DIR="${CHESS_ARENA_HOME:-$HOME/.chess-arena}"
IMAGE=chess-arena-server
CONTAINER=chess-arena-server
NETWORK=chess-arena-net
PORT=8080
REPO="$(cd "$(dirname "$0")/.." && pwd)"

health() { curl -fsS "http://127.0.0.1:$PORT/health"; }

wait_healthy() {
  for _ in $(seq 1 30); do
    if health >/dev/null 2>&1; then health; echo; return 0; fi
    sleep 1
  done
  echo "Server did not become healthy:" >&2
  docker logs --tail 30 "$CONTAINER" >&2 || true
  return 1
}

live_games() { health 2>/dev/null | sed -n 's/.*"liveGames":\([0-9]*\).*/\1/p'; }

run_container() {
  local tag="$1"
  mkdir -p "$HOME_DIR/maintenance"
  chmod 700 "$HOME_DIR" "$HOME_DIR/maintenance"
  docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
  docker run -d --name "$CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK" \
    -p "127.0.0.1:$PORT:$PORT" \
    --env-file "$HOME_DIR/server.env" \
    -e MAINTENANCE_FILE=/maintenance/message.txt \
    -v "$HOME_DIR/maintenance:/maintenance:ro" \
    --read-only --tmpfs /tmp:size=16m \
    --cap-drop ALL --security-opt no-new-privileges \
    --memory 512m --pids-limit 256 \
    --log-driver local --log-opt max-size=10m --log-opt max-file=5 \
    "$IMAGE:$tag" >/dev/null
}

swap_to() {
  local tag="$1"
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    local games
    games="$(live_games || true)"
    [ -n "$games" ] && [ "$games" != 0 ] &&
      echo "Note: $games live game(s); the server waits up to SHUTDOWN_GRACE_MS for them, then ends the rest."
    # SIGTERM: stop taking new games, wait for live ones, then exit.
    docker stop -t 40 "$CONTAINER" >/dev/null
    docker rm "$CONTAINER" >/dev/null
  fi
  run_container "$tag"
  wait_healthy
}

case "${1:-}" in
  deploy)
    cd "$REPO"
    docker build -f server/Dockerfile -t "$IMAGE:next" .
    # Keep what runs now as :previous for a rollback.
    if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
      docker tag "$IMAGE:latest" "$IMAGE:previous"
    fi
    docker tag "$IMAGE:next" "$IMAGE:latest"
    swap_to latest
    echo "Deployed $(git -C "$REPO" rev-parse --short HEAD)."
    ;;
  rollback)
    docker image inspect "$IMAGE:previous" >/dev/null
    docker tag "$IMAGE:latest" "$IMAGE:failed"
    docker tag "$IMAGE:previous" "$IMAGE:latest"
    swap_to latest
    echo "Rolled back (the replaced image is tagged $IMAGE:failed)."
    ;;
  maintenance)
    mkdir -p "$HOME_DIR/maintenance"
    if [ "${2:-}" = off ]; then
      rm -f "$HOME_DIR/maintenance/message.txt"
      echo "Maintenance off (takes effect within 5 seconds)."
    else
      [ -n "${2:-}" ] || { echo "Usage: $0 maintenance \"<message>\" | off" >&2; exit 2; }
      printf '%s\n' "$2" >"$HOME_DIR/maintenance/message.txt"
      echo "Maintenance on (within 5 seconds). Players in a game can finish it."
    fi
    ;;
  status)
    health && echo
    docker ps --filter "name=chess-arena" --format '{{.Names}}\t{{.Status}}'
    echo "Warnings and errors in the last 24 h:"
    docker logs --since 24h "$CONTAINER" 2>&1 >/dev/null | tail -20 || true
    ;;
  *)
    sed -n '2,15p' "$0"
    exit 2
    ;;
esac
