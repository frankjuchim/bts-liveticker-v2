#!/bin/bash
# Richtet den BTS Liveticker mit Docker ein (Liveticker + Watchtower für den Update-Knopf).
#   curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/deploy/docker-install.sh | bash
# Voraussetzung: Docker mit „docker compose“. Ordner per DIR=… änderbar (Standard ./bts-liveticker).
set -euo pipefail

DIR="${DIR:-$PWD/bts-liveticker}"
RAW="https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main"

command -v docker >/dev/null || { echo "Docker fehlt – bitte zuerst Docker installieren." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "„docker compose“ fehlt (Docker Compose v2)." >&2; exit 1; }

mkdir -p "$DIR"
cd "$DIR"
echo "==> Ordner $DIR"
curl -fsSL "$RAW/docker-compose.yml" -o docker-compose.yml

rand() { head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
if [ ! -f .env ]; then
  echo "==> .env mit zufälligen Passwörtern anlegen"
  cat > .env <<CONF
# Passwort, das in BTS beim Ticker eingetragen wird (im Admin-Panel änderbar)
TICKER_PASSWORD=$(rand)
# Admin-Passwort fest vorgeben (leer: Standard btsliveadmin, im Admin-Panel änderbar)
ADMIN_PASSWORD=
# Geheimer Schlüssel zwischen Liveticker und Watchtower (Update-Knopf)
UPDATE_TOKEN=$(rand)
# Port auf dem Server
PORT=${PORT:-80}
TITLE=Badminton
SUBTITLE=Turnier-Liveticker
CONF
  chmod 600 .env
fi

echo "==> Container holen und starten"
docker compose pull -q
docker compose up -d

PORT=$(sed -n 's/^PORT=//p' .env | tail -1); PORT=${PORT:-80}
OK=""
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
[ -n "$OK" ] || { echo "!! Liveticker antwortet nicht – Protokoll: docker compose logs liveticker" >&2; exit 1; }

IP=$(hostname -I 2>/dev/null | awk '{print $1}'); IP=${IP:-<server>}
SUFFIX=""; [ "$PORT" = 80 ] || SUFFIX=":$PORT"
cat <<INFO

==> Läuft.
  Liveticker:        http://$IP$SUFFIX/
  Admin-Panel:       http://$IP$SUFFIX/admin  (Passwort btsliveadmin, bitte gleich ändern)
  In BTS eintragen:  Ticker-Adresse  ws://$IP$SUFFIX/ws/update
                     Ticker-Passwort $(sed -n 's/^TICKER_PASSWORD=//p' .env)
  Einstellungen:     $DIR/.env  (danach: docker compose up -d)
  Update:            Knopf im Admin-Panel, oder hier: docker compose pull && docker compose up -d

INFO
