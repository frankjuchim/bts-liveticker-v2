#!/bin/bash
# Aktualisiert eine BTS-Installation und spielt danach die Liveticker-Erweiterung wieder ein.
# Im BTS-Verzeichnis (dort, wo bts/ticker_conn.js liegt) als der Benutzer ausführen,
# dem die Installation gehört:
#
#   curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/bts-patch/update-bts.sh | bash
#
# Auf einen anderen Branch / ein anderes Repo wechseln (z. B. Tims BTSv2):
#
#   curl -fsSL …/update-bts.sh | bash -s -- --repo https://github.com/tlehr/bts.git --branch feat/BTSv2
#
# Ablauf: Sicherung von data/ und config.json → neuester Stand von GitHub (die eigene
# Erweiterung wird dabei entfernt und danach neu eingespielt) → npm install → bup
# aktualisieren → Erweiterung einspielen → BTS neu starten.
# Weitere Schalter: --no-backup, --no-extension, --no-restart
set -euo pipefail

APPLY_URL="${APPLY_URL:-https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/bts-patch/apply.sh}"
PATCH_SUBJECT="Ticker-Erweiterung für bts-liveticker"
REPO=""; BRANCH=""; BACKUP=1; EXTENSION=1; RESTART=1
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --no-backup) BACKUP=""; shift ;;
    --no-extension) EXTENSION=""; shift ;;
    --no-restart) RESTART=""; shift ;;
    -h|--help) sed -n '2,15p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
  esac
done

say() { echo "==> $*"; }
die() { echo "FEHLER: $*" >&2; exit 1; }

[ -f bts/ticker_conn.js ] || die "Hier liegt kein BTS (bts/ticker_conn.js fehlt). Bitte ins BTS-Verzeichnis wechseln."
git rev-parse --git-dir >/dev/null 2>&1 || die "Das BTS-Verzeichnis ist kein git-Repository."
command -v node >/dev/null || die "node nicht gefunden."
command -v npm >/dev/null || die "npm nicht gefunden."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no >&2
  die "Im BTS-Verzeichnis gibt es nicht committete Änderungen. Bitte sichern oder verwerfen (git stash), dann erneut ausführen."
fi

OLD=$(git rev-parse HEAD)
OLD_BRANCH=$(git rev-parse --abbrev-ref HEAD)
say "BTS jetzt: Branch $OLD_BRANCH, Stand $(git log -1 --format='%h %cd' --date=short)"

# 1. Sicherung der Turnierdaten
if [ -n "$BACKUP" ]; then
  DEST="../bts-backups"
  mkdir -p "$DEST"
  FILE="$DEST/bts-$(date +%Y%m%d-%H%M%S).tar.gz"
  ITEMS=""
  for x in data config.json ticker_config.json; do [ -e "$x" ] && ITEMS="$ITEMS $x"; done
  if [ -n "$ITEMS" ]; then
    say "Sicherung: $FILE ($ITEMS )"
    # shellcheck disable=SC2086
    tar -czf "$FILE" $ITEMS
  fi
fi

# 2. Quelle bestimmen (anderer Branch/Repo oder der bisherige)
if [ -n "$BRANCH" ]; then
  REMOTE="origin"
  if [ -n "$REPO" ]; then
    REMOTE=""
    for r in $(git remote); do
      u=$(git remote get-url "$r")
      [ "${u%.git}" = "${REPO%.git}" ] && REMOTE="$r"
    done
    if [ -z "$REMOTE" ]; then
      REMOTE=$(echo "$REPO" | sed -E 's#.*[:/]([^/]+)/[^/]+$#\1#')
      git remote get-url "$REMOTE" >/dev/null 2>&1 && REMOTE="$REMOTE-bts"
      say "Neue Quelle $REMOTE: $REPO"
      git remote add "$REMOTE" "$REPO"
    fi
  fi
  say "Hole $REMOTE/$BRANCH"
  git fetch -q "$REMOTE" "$BRANCH"
  LOCAL="${BRANCH##*/}"
  if git rev-parse -q --verify "refs/heads/$LOCAL" >/dev/null && [ "$LOCAL" != "$OLD_BRANCH" ]; then
    git switch -q "$LOCAL"
  elif ! git rev-parse -q --verify "refs/heads/$LOCAL" >/dev/null; then
    git switch -q -c "$LOCAL" --track "$REMOTE/$BRANCH"
  fi
  git branch -q --set-upstream-to "$REMOTE/$BRANCH"
else
  git rev-parse -q --verify '@{upstream}' >/dev/null || die "Der Branch $OLD_BRANCH hat keinen Upstream. Mit --branch (und ggf. --repo) angeben, woher BTS kommen soll."
  UP=$(git rev-parse --abbrev-ref '@{upstream}')
  say "Hole ${UP}"
  git fetch -q "${UP%%/*}" "${UP#*/}"
fi

# 3. Auf den neuen Stand bringen. Eigene Erweiterungs-Commits werden verworfen
#    (sie werden unten neu eingespielt); andere lokale Commits per Rebase behalten.
KEEP=""
for c in $(git log --reverse --format=%H '@{upstream}..HEAD'); do
  git log -1 --format=%s "$c" | grep -q "^$PATCH_SUBJECT" || KEEP="$KEEP $c"
done
git reset -q --hard '@{upstream}'
if [ -n "$KEEP" ]; then
  say "Eigene lokale Commits werden auf den neuen Stand gesetzt:"
  for c in $KEEP; do
    echo "     $(git log -1 --format='%h %s' "$c")"
    if ! git cherry-pick -q "$c" >/dev/null; then
      git cherry-pick --abort 2>/dev/null || true
      git switch -q "$OLD_BRANCH" 2>/dev/null || true
      git reset -q --hard "$OLD"
      die "Der lokale Commit $(git log -1 --format=%h "$c") passt nicht auf den neuen Stand – nichts geändert. Bitte von Hand zusammenführen."
    fi
  done
fi
CHANGES=$(git log --oneline --no-decorate "$OLD..HEAD" 2>/dev/null | grep -v "$PATCH_SUBJECT" | head -15 || true)
if [ -n "$CHANGES" ]; then
  say "Neu in BTS:"
  echo "$CHANGES" | sed 's/^/     /'
else
  say "Keine neuen BTS-Commits"
fi

ROLLBACK="git switch -q $OLD_BRANCH 2>/dev/null; git reset --hard $OLD && npm install && sudo systemctl restart bts"

# 4. Abhängigkeiten
say "npm install"
if ! npm install --no-audit --no-fund --loglevel=error; then
  echo "npm install ist fehlgeschlagen. Zurück zum alten Stand:" >&2
  echo "  $ROLLBACK" >&2
  exit 1
fi

# 5. bup (Schiedsrichter-App), falls als eigenes git-Repo eingebunden
for d in static/bup/dev static/bup; do
  if [ -d "$d/.git" ] || [ -f "$d/.git" ]; then
    say "bup aktualisieren ($d)"
    (cd "$d" && git pull -q --ff-only) || echo "Hinweis: bup in $d konnte nicht aktualisiert werden – BTS läuft trotzdem." >&2
    break
  fi
done

# 6. Liveticker-Erweiterung
if [ -n "$EXTENSION" ]; then
  say "Liveticker-Erweiterung einspielen"
  if ! curl -fsSL "$APPLY_URL" | NO_RESTART=1 bash; then
    echo "Hinweis: Die Erweiterung ließ sich nicht einspielen – BTS läuft ohne sie (der Ticker funktioniert trotzdem)." >&2
    git checkout -q -- bts/ticker_conn.js 2>/dev/null || true
  fi
fi

# 7. Neustart (nur wenn sich etwas geändert hat – mitten im Turnier nicht unnötig)
if [ "$(git rev-parse "HEAD^{tree}")" = "$(git rev-parse "$OLD^{tree}")" ]; then
  say "Nichts geändert – kein Neustart nötig"
  RESTART=""
fi
if [ -n "$RESTART" ] && systemctl cat bts.service >/dev/null 2>&1; then
  say "BTS neu starten"
  if [ "$(id -u)" = 0 ]; then systemctl restart bts; else sudo systemctl restart bts; fi
elif [ -n "$RESTART" ]; then
  echo "Bitte BTS jetzt neu starten (kein systemd-Dienst „bts“ gefunden)."
fi

say "Fertig: Branch $(git rev-parse --abbrev-ref HEAD), Stand $(git log -1 --format='%h %cd' --date=short)"
echo "Zurück zum vorherigen Stand, falls nötig:"
echo "  $ROLLBACK"
