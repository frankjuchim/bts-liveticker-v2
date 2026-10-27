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

## Einspielen (empfohlen: Skript)

Auf dem Rechner/Container, auf dem BTS läuft, **im BTS-Verzeichnis** (dort, wo der
Ordner `bts/` mit `ticker_conn.js` liegt), als der Benutzer, dem die Installation gehört:

```sh
curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/bts-patch/apply.sh | bash
```

Das Skript

1. prüft, dass es ein BTS-git-Verzeichnis ohne offene Änderungen ist,
2. fügt die Erweiterung ein und prüft, dass das Ergebnis gültiges JavaScript ist,
3. legt dafür einen **lokalen Commit** an („Ticker: Aufschläger/Rückschläger senden“),
4. stellt `git pull` auf Rebase um (`pull.rebase`, `rebase.autoStash`),
5. startet den Dienst `bts` neu (falls vorhanden – sonst BTS bitte selbst neu starten).

Mehrfaches Ausführen schadet nicht („bereits eingespielt“).

Danach verbindet sich BTS neu mit dem Liveticker; beim nächsten Punkt erscheinen
Punkt und Unterstreichung.

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
