# BTS-Erweiterung: Aufschläger und Rückschläger

Das unveränderte BTS schickt dem Ticker nur den Spielstand. Wer aufschlägt und wo die
Spieler stehen, weiß BTS aber bereits (von der Zähl-App bup). Diese Erweiterung schickt
diese Angaben mit, damit der Liveticker

- beim **Aufschläger** einen Punkt zeigt (Einzel und Doppel) und
- im **Doppel** den **Rückschläger** unterstreicht.

Ohne Erweiterung funktioniert der Liveticker ganz normal, nur ohne diese Markierungen.

## Was geändert wird

Nur die Datei `bts/ticker_conn.js`, 12 Zeilen. Zusätzlich gesendet werden:

| Feld | Bedeutung | Quelle in BTS |
| --- | --- | --- |
| `ts` | Team 1 schlägt auf | `network_team1_serving` |
| `pe` | je Team: steht Spieler 1 im rechten (geraden) Feld | `network_teams_player1_even` |
| `d` | Doppel | `setup.is_doubles` |

Der Liveticker berechnet daraus Aufschläger und Rückschläger genauso wie BTS selbst
(`determine_server`/`determine_receiver` in `bts/bupws_v2.js`). Am Zählen, an der
Verbindung zu BTP und an den Anzeigen in der Halle ändert sich nichts.

Getestet mit `tlehr/bts` (`master`, `feat/bupws_v2`, `perf/server-responsiveness`) und
`phihag/bts` (`master`).

## Wo wird was gemacht?

Liveticker und BTS laufen meist auf **verschiedenen Maschinen** (z. B. zwei Container auf
verschiedenen Proxmox-Servern). Die Erweiterung gehört **zu BTS**:

```
 Maschine A: BTS                          Maschine B: Liveticker (dieses Repo)
 ┌───────────────────────────────┐        ┌──────────────────────────────┐
 │ BTS-Verzeichnis               │  ws:// │ bts-liveticker               │
 │  └─ bts/ticker_conn.js  ◄──── │ ─────► │                              │
 │     HIER die Erweiterung      │        │ hier ist nichts zu tun       │
 └───────────────────────────────┘        └──────────────────────────────┘
```

Am Liveticker ist nichts zu tun – er erkennt die Erweiterung automatisch. Ob sie aktiv ist,
zeigt `http://<Liveticker>/admin` in der Zeile **Aufschlaganzeige**.

## Einspielen – Schritt für Schritt

### 1. Auf die BTS-Maschine kommen

Je nachdem, wo BTS läuft:

- **BTS in einem Proxmox-Container (LXC):** im Proxmox-Web-UI den BTS-Container auswählen →
  **Konsole**. Oder auf dem Proxmox-Host, auf dem BTS liegt: `pct enter <CTID>`
  (die CTID steht in der Liste links im Web-UI).
- **BTS in einer VM oder auf einem Linux-Rechner:** per SSH, z. B. `ssh root@<IP-von-BTS>`.
- **BTS unter Windows:** im BTS-Ordner „Git Bash“ öffnen (kommt mit Git für Windows) –
  die Befehle unten funktionieren dort genauso; BTS danach von Hand neu starten.

### 2. Ins BTS-Verzeichnis wechseln

Das ist der Ordner, in dem der Unterordner `bts/` mit `ticker_conn.js` liegt
(dort liegen auch `package.json` und `update-bts.sh`). Wer nicht weiß, wo er ist:

```sh
systemctl cat bts | grep WorkingDirectory        # wenn BTS als Dienst „bts“ läuft
find / -path '*/bts/ticker_conn.js' 2>/dev/null  # sonst suchen; gesucht ist der Ordner über bts/
```

Beispiel: `find` liefert `/root/bts/bts/ticker_conn.js` → das BTS-Verzeichnis ist `/root/bts`:

```sh
cd /root/bts
```

### 3. Erweiterung einspielen

```sh
curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/bts-patch/apply.sh | bash
```

(Fehlt `curl`: `apt-get install -y curl`.) Das Skript

1. prüft, dass es ein BTS-git-Verzeichnis ohne offene Änderungen ist,
2. fügt die Erweiterung ein und prüft, dass das Ergebnis gültiges JavaScript ist,
3. legt dafür einen **lokalen Commit** an („Ticker: Aufschläger/Rückschläger senden“),
4. stellt `git pull` auf Rebase um (`pull.rebase`, `rebase.autoStash`),
5. startet den Dienst `bts` neu (falls vorhanden – sonst BTS bitte selbst neu starten).

Mehrfaches Ausführen schadet nicht („bereits eingespielt“).

### 4. Prüfen

BTS verbindet sich nach dem Neustart von selbst wieder mit dem Liveticker. Sobald ein Spiel
auf einem Court liegt, zeigt `http://<Liveticker>/admin` bei **Aufschlaganzeige**
„aktiv“, und beim nächsten Punkt erscheinen Punkt und Unterstreichung.

## Was passiert bei BTS-Updates?

Die Installation bleibt mit dem Original-Repo verbunden (`origin`). `git pull` – auch über
`update-bts.sh` – holt wie gewohnt alle Updates und legt die Erweiterung als einen Commit
wieder obendrauf. `git status` zeigt dann z. B.:

```
Your branch is ahead of 'origin/feat/bupws_v2' by 1 commit.
```

Das ist richtig so (Original + Erweiterung). Den Hinweis „use git push“ bitte ignorieren.

- **Übernimmt BTS die Änderung selbst**, fällt der lokale Commit beim Pull von allein weg.
- **Ändert BTS genau diese Stellen**, bricht `git pull` mit einem Konflikt ab, ohne etwas
  kaputtzumachen. Dann:
  ```sh
  git rebase --abort
  git reset --hard origin/$(git rev-parse --abbrev-ref HEAD)
  curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/bts-patch/apply.sh | bash
  ```

## Wieder entfernen

```sh
git reset --hard origin/$(git rev-parse --abbrev-ref HEAD)
sudo systemctl restart bts
```

Achtung: `reset --hard` verwirft **alle** lokalen Änderungen im BTS-Verzeichnis, nicht nur
diese Erweiterung.

## Von Hand

Wer lieber selbst einspielt: `bts-patch/ticker-aufschlag.patch` ist die Änderung als Diff
(erstellt auf `perf/server-responsiveness`; auf anderen Ständen passen ggf. die Zeilen
nicht – dann das Skript `bts-patch/ticker-aufschlag.js` nehmen):

```sh
node ticker-aufschlag.js bts/ticker_conn.js
node --check bts/ticker_conn.js
git commit -am "Ticker: Aufschläger/Rückschläger senden"
```

Läuft BTS **ohne git** (z. B. aus einem ZIP oder Docker-Image), `ticker-aufschlag.js` genauso
auf `bts/ticker_conn.js` anwenden – dann muss die Erweiterung nach jedem BTS-Update erneut
eingespielt werden.
