#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE="${1:?Usage: deploy-release.sh <release>}"
APP="/home/li/apps/hearth-draw"
STAGE="$APP/.deploy-$RELEASE"
BACKUP="$APP/.backup-$RELEASE"
SWAPPED=0

rollback() {
  if [[ "$SWAPPED" -ne 1 ]]; then
    return
  fi

  set +e
  sudo systemctl stop hearth-draw
  if [[ -d "$APP/dist" ]]; then
    mv "$APP/dist" "$STAGE/dist.failed"
  fi
  if [[ -d "$BACKUP/dist" ]]; then
    mv "$BACKUP/dist" "$APP/dist"
  fi
  cp "$BACKUP/server/"*.mjs "$APP/server/"
  cp "$BACKUP/src/"*.mjs "$APP/src/"
  cp "$BACKUP/collectible_cards_zhCN.full.json" "$APP/"
  if [[ -f "$BACKUP/.release" ]]; then
    cp "$BACKUP/.release" "$APP/.release"
  else
    rm -f "$APP/.release"
  fi
  sudo systemctl start hearth-draw
  echo "Deployment failed; restored the previous release." >&2
}

trap rollback ERR

test -d "$STAGE/dist"
test -f "$STAGE/dist/hearthcards/source.json"
test -f "$STAGE/server/index.mjs"
test -f "$STAGE/server/game-utils.mjs"
test -f "$STAGE/server/bot-drawing.mjs"
test -f "$STAGE/src/outline-assist.mjs"
test -f "$STAGE/src/score-rules.mjs"
test -f "$STAGE/collectible_cards_zhCN.full.json"
test ! -e "$BACKUP"

health_json="$(curl -fsS http://127.0.0.1:3000/api/health)"
node -e 'const h=JSON.parse(process.argv[1]); if (!h.ok || h.rooms !== 0 || h.online !== 0) process.exit(1)' "$health_json"

mkdir -p "$BACKUP/server" "$BACKUP/src"
cp "$APP/server/"*.mjs "$BACKUP/server/"
cp "$APP/src/"*.mjs "$BACKUP/src/"
cp "$APP/collectible_cards_zhCN.full.json" "$BACKUP/"
if [[ -f "$APP/.release" ]]; then
  cp "$APP/.release" "$BACKUP/.release"
fi

sudo systemctl stop hearth-draw
mv "$APP/dist" "$BACKUP/dist"
SWAPPED=1
cp "$STAGE/server/"*.mjs "$APP/server/"
cp "$STAGE/src/"*.mjs "$APP/src/"
cp "$STAGE/collectible_cards_zhCN.full.json" "$APP/"
mv "$STAGE/dist" "$APP/dist"
printf '%s\n' "$RELEASE" > "$APP/.release"
sudo systemctl start hearth-draw

healthy=0
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/api/health > /tmp/hearth-draw-health.json 2>/dev/null; then
    healthy=1
    break
  fi
  sleep 0.5
done
test "$healthy" -eq 1
node -e 'const fs=require("fs"); const h=JSON.parse(fs.readFileSync("/tmp/hearth-draw-health.json", "utf8")); if (!h.ok || h.cards !== 5993 || h.cardImageExtension !== "webp") process.exit(1)'
test "$(systemctl is-active hearth-draw)" = "active"

trap - ERR
echo "DEPLOYED=$RELEASE"
cat /tmp/hearth-draw-health.json
