#!/bin/bash
# Spielt die Ticker-Erweiterung (v3) in eine BTS-Installation ein oder ersetzt eine ältere.
# Im BTS-Verzeichnis (dort, wo bts/ticker_conn.js liegt) als der Benutzer ausführen,
# dem die Installation gehört:
#
#   curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/bts-patch/apply.sh | bash
#
# Der Patch wird als eigener lokaler Commit angelegt; „git pull“ (auch über
# update-bts.sh) setzt ihn danach bei jedem Update wieder obendrauf.
set -euo pipefail

SCRIPT_URL="${SCRIPT_URL:-https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/bts-patch/ticker-aufschlag.js}"
VERSION=3
MESSAGE="Ticker-Erweiterung für bts-liveticker (v$VERSION): Aufschlag, Vereine, Spieldauer, nächste Spiele, Turnierbäume"

[ -f bts/ticker_conn.js ] || { echo "Hier liegt kein BTS (bts/ticker_conn.js fehlt). Bitte ins BTS-Verzeichnis wechseln." >&2; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "Das BTS-Verzeichnis ist kein git-Repository – siehe docs/BTS-UPGRADE.md (manuell)." >&2; exit 1; }
command -v node >/dev/null || { echo "node nicht gefunden (wird von BTS ohnehin gebraucht)." >&2; exit 1; }

if grep -q "bts-liveticker-erweiterung v$VERSION" bts/ticker_conn.js; then
  echo "Die Erweiterung (v$VERSION) ist bereits eingespielt – nichts zu tun."
  exit 0
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Im BTS-Verzeichnis gibt es nicht committete Änderungen:" >&2
  git status --short --untracked-files=no >&2
  echo "Bitte zuerst sichern oder verwerfen (git stash), dann erneut ausführen." >&2
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "==> BTS auf Branch $BRANCH"

# Upgrade von einer älteren Version (v1, v2): Originaldatei wiederherstellen – aus dem
# letzten eigenen BTS-Commit ohne Erweiterung, sonst aus dem Original-Repo –, dann die
# neue Version einsetzen
if grep -q "craft_service" bts/ticker_conn.js; then
  echo "==> Ältere Version der Erweiterung gefunden – wird ersetzt"
  RESTORED=""
  for C in $(git log --format=%H -n 30 -- bts/ticker_conn.js); do
    if git show "$C:bts/ticker_conn.js" 2>/dev/null | grep -q "craft_service"; then continue; fi
    git show "$C:bts/ticker_conn.js" > bts/ticker_conn.js
    RESTORED=1
    break
  done
  if [ -z "$RESTORED" ]; then
    if ! git rev-parse -q --verify '@{upstream}' >/dev/null; then
      echo "Kein Original-Stand gefunden – bitte bts/ticker_conn.js von Hand wiederherstellen." >&2
      exit 1
    fi
    git show '@{upstream}:bts/ticker_conn.js' > bts/ticker_conn.js
  fi
  if grep -q "craft_service" bts/ticker_conn.js; then
    echo "Das Original-Repo enthält bereits eine Erweiterung – nichts zu tun."
    git checkout -- bts/ticker_conn.js
    exit 0
  fi
fi

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
curl -fsSL "$SCRIPT_URL" -o "$TMP"

if ! node "$TMP" bts/ticker_conn.js; then
  git checkout -- bts/ticker_conn.js
  echo "Die Erweiterung passt nicht auf diesen BTS-Stand – bitte ein Issue im Repo bts-liveticker-v2 anlegen." >&2
  exit 1
fi
if ! node --check bts/ticker_conn.js; then
  git checkout -- bts/ticker_conn.js
  echo "Ergebnis ist kein gültiges JavaScript – nichts geändert. Bitte ein Issue anlegen." >&2
  exit 1
fi

echo "==> Lokalen Commit anlegen"
git add bts/ticker_conn.js
git -c user.name="${GIT_AUTHOR_NAME:-BTS}" -c user.email="${GIT_AUTHOR_EMAIL:-bts@localhost}" commit -q -m "$MESSAGE"

echo "==> git pull behält den Patch künftig obendrauf"
git config pull.rebase true
git config rebase.autoStash true

if systemctl list-unit-files bts.service >/dev/null 2>&1 && systemctl cat bts.service >/dev/null 2>&1; then
  echo "==> BTS neu starten"
  if [ "$(id -u)" = 0 ]; then systemctl restart bts; else sudo systemctl restart bts; fi
  echo "Fertig. BTS verbindet sich neu mit dem Liveticker."
else
  echo "Fertig. Bitte BTS jetzt neu starten (kein systemd-Dienst „bts“ gefunden)."
fi
git status -sb | head -1
