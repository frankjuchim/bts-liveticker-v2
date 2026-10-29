# BTS-Erweiterung für den Liveticker

Das unveränderte BTS schickt dem Ticker nur die Spiele auf den Courts mit ihrem Spielstand.
Vieles mehr weiß BTS aber bereits. Diese Erweiterung (Version 2) schickt es mit, damit der
Liveticker zusätzlich

- beim **Aufschläger** einen Punkt zeigt und im **Doppel** den **Rückschläger** unterstreicht,
  inklusive **Spielfeld-Ansicht** wie in bup,
- die **Vereine** der Spieler anzeigt (sonst die Nation) – auch zum Folgen ganzer Vereine,
- die **Spieldauer** aus bup anzeigt (Ergebnisse, Statistik),
- **„Als Nächstes“** zeigt: die Spiele in Vorbereitung und die geplanten Spiele mit Uhrzeit –
  auch auf der Seite „Meine Spieler“ und für Hinweise „Gleich dran“,
- daraus den **Verzug zum Zeitplan** und den **voraussichtlichen Beginn** der nächsten Spiele
  schätzt (als unverbindliche Schätzung gekennzeichnet).

| Funktion | ohne Erweiterung | mit Erweiterung v2 |
| --- | --- | --- |
| Spielstände, Ergebnisse, Overlays, Ergebnis-Einblendung | ✓ | ✓ |
| Spielern folgen, Hinweise bei Aufruf und Spielende, Spielerseite | ✓ | ✓ |
| Aufschläger (Punkt) und Rückschläger (unterstrichen) | – | ✓ |
| Spielfeld-Ansicht wie in bup | – | ✓ |
| Vereine der Spieler (anzeigen, Vereinen folgen) | – | ✓ |
| Spieldauer | geschätzt (ab erstem Punkt) | genau (aus bup) |
| „Als Nächstes“: Spiele in Vorbereitung und angesetzte Spiele | – | ✓ |
| Verzug zum Zeitplan und voraussichtlicher Beginn (Schätzung) | – | ✓ |

Ohne Erweiterung funktioniert der Liveticker ganz normal, nur ohne diese Angaben (die
Spieldauer schätzt er dann selbst vom ersten Punkt bis zum Spielende).

## Was geändert wird

Nur die Datei `bts/ticker_conn.js` (gut 50 Zeilen). Zusätzlich gesendet werden:

| Feld | Bedeutung | Quelle in BTS | Nachricht |
| --- | --- | --- | --- |
| `ts` | Team 1 schlägt auf | `network_team1_serving` | `tset`, `tupdate_match` |
| `pe` | je Team: steht Spieler 1 im rechten (geraden) Feld | `network_teams_player1_even` | `tset`, `tupdate_match` |
| `d` | Doppel | `setup.is_doubles` | `tset` |
| `c0`, `c1` | Verein je Spieler (sonst Nation) | `setup.teams[].players[].club` / `.nationality` | `tset` |
| `dur` | Spieldauer in ms | `duration_ms` (von bup) | `tset`, `tupdate_match` |
| `upcoming` | bis zu 60 nächste Spiele: Name, Spieler, Vereine, Planzeit `t`/`dt`, Zustand `st`, Spielnummer `mn` | Spiele mit `setup.state` `preparation` oder `scheduled` | `tset` |

„Als Nächstes“ enthält nur Spiele, die nicht auf einem Court liegen, noch kein Ergebnis haben
und bei denen beide Seiten feststehen – zuerst die in Vorbereitung, dann nach Planzeit. Die
Liste wird bei jeder Court-Änderung neu geschickt.

Der Liveticker berechnet Aufschläger und Rückschläger genauso wie BTS selbst
(`determine_server`/`determine_receiver` in `bts/bupws_v2.js`). Am Zählen, an der
Verbindung zu BTP und an den Anzeigen in der Halle ändert sich nichts.

Getestet mit `tlehr/bts` (`master`, `feat/bupws_v2`, `perf/server-responsiveness`) und
`phihag/bts` (`master`) – jeweils neu eingespielt und als Upgrade von der ersten Version.

**Schon die erste Version (nur Aufschlag) installiert?** Einfach denselben Befehl wie unten
noch einmal ausführen – das Skript ersetzt sie durch die neue Version.

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
zeigt `http://<Liveticker>/admin` in der Zeile **BTS-Erweiterung** („aktiv (v2)“ bzw. „ältere
Version“).

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
2. ersetzt eine ältere Version der Erweiterung (holt dazu die Originaldatei aus dem Original-Repo),
3. fügt die Erweiterung ein und prüft, dass das Ergebnis gültiges JavaScript ist,
4. legt dafür einen **lokalen Commit** an („Ticker-Erweiterung für bts-liveticker (v2) …“),
5. stellt `git pull` auf Rebase um (`pull.rebase`, `rebase.autoStash`),
6. startet den Dienst `bts` neu (falls vorhanden – sonst BTS bitte selbst neu starten).

Mehrfaches Ausführen schadet nicht („bereits eingespielt“).

### 4. Prüfen

BTS verbindet sich nach dem Neustart von selbst wieder mit dem Liveticker. Sobald ein Spiel
auf einem Court liegt, zeigt `http://<Liveticker>/admin` bei **BTS-Erweiterung**
„aktiv (v2)“: Beim nächsten Punkt erscheinen Punkt und Unterstreichung, die Vereine stehen
bei den Spielern und im Liveticker gibt es den Bereich „Als Nächstes“.

## Was passiert bei BTS-Updates?

Die Installation bleibt mit dem Original-Repo verbunden (`origin`). `git pull` – auch über
`update-bts.sh` – holt wie gewohnt alle Updates und legt die Erweiterung als einen Commit
wieder obendrauf. `git status` zeigt dann z. B.:

```
Your branch is ahead of 'origin/feat/bupws_v2' by 1 commit.
```

(bzw. „by 2 commits“ nach einem Upgrade von der ersten Version). Das ist richtig so
(Original + Erweiterung). Den Hinweis „use git push“ bitte ignorieren.

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
git commit -am "Ticker-Erweiterung für bts-liveticker (v2)"
```

Das Skript erwartet die Originaldatei; eine ältere Version der Erweiterung vorher entfernen
(`git checkout @{upstream} -- bts/ticker_conn.js`).

Läuft BTS **ohne git** (z. B. aus einem ZIP oder Docker-Image), `ticker-aufschlag.js` genauso
auf `bts/ticker_conn.js` anwenden – dann muss die Erweiterung nach jedem BTS-Update erneut
eingespielt werden.
