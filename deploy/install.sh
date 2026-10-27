#!/bin/bash
# Installiert (oder aktualisiert) den BTS Liveticker in einem Debian-Container.
# Als root im Container ausführen:
#   curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/deploy/install.sh | bash
set -euo pipefail

REPO="${REPO:-https://github.com/frankjuchim/bts-liveticker-v2.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/bts-liveticker
DATA_DIR=/var/lib/bts-liveticker
ENV_FILE=/etc/bts-liveticker.env

[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen." >&2; exit 1; }

echo "==> Pakete installieren (nodejs, npm, git)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nodejs npm git ca-certificates curl >/dev/null

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js $NODE_MAJOR ist zu alt (mindestens 18 nötig) – bitte Debian 12 oder neuer verwenden." >&2
  exit 1
fi

echo "==> Programm nach $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

echo "==> Benutzer und Datenverzeichnis"
id btsticker >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin btsticker
mkdir -p "$DATA_DIR"
chown btsticker:btsticker "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "==> Konfiguration $ENV_FILE anlegen"
  PASSWORD=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > "$ENV_FILE" <<CONF
# BTS Liveticker – nach Änderungen: systemctl restart bts-liveticker
PORT=80
DATA_DIR=$DATA_DIR

# Passwort, das in BTS beim Ticker eingetragen wird
TICKER_PASSWORD=$PASSWORD

# Erscheinungsbild
TITLE="Badminton"
SUBTITLE="Turnier-Liveticker"
ACCENT="#1f5f99"
# Logo, Titel und Farbe lassen sich auch im Admin-Panel (/admin) ändern.
# Logo alternativ als Dateipfad:
#LOGO_FILE=/pfad/zum/logo.png
CONF
  chmod 640 "$ENV_FILE"
  chown root:btsticker "$ENV_FILE"
fi

echo "==> Dienst einrichten"
install -m 644 "$APP_DIR/deploy/bts-liveticker.service" /etc/systemd/system/bts-liveticker.service
systemctl daemon-reload
systemctl enable -q bts-liveticker
systemctl restart bts-liveticker

sleep 2
PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)
PORT=${PORT:-80}
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null; then
  echo "==> Läuft."
else
  echo "!! Dienst antwortet nicht – Log: journalctl -u bts-liveticker -n 50" >&2
  exit 1
fi

IP=$(hostname -I | awk '{print $1}')
SUFFIX=""; [ "$PORT" = 80 ] || SUFFIX=":$PORT"
cat <<INFO

  Liveticker:        http://$IP$SUFFIX/
  Status/Overlays:   http://$IP$SUFFIX/admin
  In BTS eintragen:  Ticker-Adresse  ws://$IP$SUFFIX/ws/update
                     Ticker-Passwort $(sed -n 's/^TICKER_PASSWORD=//p' "$ENV_FILE")
  Konfiguration:     $ENV_FILE
  Update:            bash $APP_DIR/deploy/update.sh

INFO
