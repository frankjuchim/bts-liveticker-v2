# Daten für den Liveticker – Aufstellung für BTS

Diese Aufstellung beschreibt **alle Daten, die der Liveticker
([bts-liveticker-v2](https://github.com/frankjuchim/bts-liveticker-v2)) von BTS braucht**. Ziel:
BTS schickt sie einmal vollständig über die bestehende Ticker-Verbindung (`bts/ticker_conn.js`),
dann ist **keine Erweiterung (Patch) mehr nötig** und der Ticker deckt Turnierbäume, Gruppen,
KO-Systeme, Zeitplan und Livestand ohne weitere BTS-Änderungen ab.

Stand: Erweiterung v4 (`bts-patch/ticker-aufschlag.js`), geprüft gegen `tlehr/bts` Branch
`feat/BTSv2` (2. 11. 2026). Alles, was der Patch heute schickt, steht unten unter „heute“ – das
kann 1:1 übernommen werden. Neu gewünscht ist mit **neu** markiert.

---

## 1. Grundsätze

- **Verbindung bleibt wie sie ist:** WebSocket `…/ws/update?password=…`, Nachrichten `tset`
  (Gesamtstand) und `tupdate_match` (Spielstand), Antwort `{ type: 'answer', status: 'ok', rid }`.
- **Version mitschicken:** `event.xv` (heute 4). Für den eingebauten Stand z. B. `xv: 10`, dann
  erkennt der Ticker, was er erwarten kann, und zeigt im Admin-Panel keinen Patch-Hinweis mehr.
- **Rückwärtskompatibel:** Der Ticker kommt mit fehlenden Feldern zurecht. Neue Felder einfach
  zusätzlich schicken; die bisherigen Kurzschlüssel (`p0`, `s`, `ts` …) bitte beibehalten.
- **IDs stabil halten:** `_id` eines Spiels, `draw_id` eines Felds und (neu) die Spieler-IDs dürfen
  sich über das Turnier nicht ändern – darauf hängen Folgen, Push-Benachrichtigungen, Bäume.
- **Datenmenge:** Ein Turnier mit ~600 Spielen ergibt mit allen Feldern ca. 200–300 KB pro `tset`.
  Das ist unkritisch; falls gewünscht, kann der Felder-Teil (Abschnitt 5) auch als eigene
  Nachricht `tdraws` nur bei Änderungen geschickt werden (siehe Abschnitt 8).

---

## 2. Turnier (`tset.event`)

| Feld | Inhalt | Quelle in BTS | Status |
| --- | --- | --- | --- |
| `tournament_name` | Turniername | `tournament.name` | heute (Original) |
| `tournament_url` | Link zu turnier.de | Turnier-Einstellungen | heute (Original) |
| `tournament_logo`, `_mime`, `_background_color` | Logo | `tournament.logo_id` | heute (Original) |
| `xv` | Version der Ticker-Daten | – | heute (Patch) |
| `tz` | Zeitzone, z. B. `Europe/Berlin` | Server | **neu** |
| `days` | Turniertage `['2026-11-14', '2026-11-15']` | aus `scheduled_date` der Spiele | **neu** |
| `location` | Halle(n): `[{ id, name }]` | `db.locations` | **neu** |

## 3. Courts (`tset.event.courts[]`)

| Feld | Inhalt | Quelle | Status |
| --- | --- | --- | --- |
| `_id`, `num`, `match_id` | Court, Nummer, Spiel darauf | `db.courts` | heute (Original) |
| `name` | Anzeigename, falls abweichend von der Nummer | `court.name` | **neu** |
| `location_id` | Halle des Courts | `court.location_id` | **neu** |

## 4. Spiele auf den Courts (`tset.event.matches[]`, `tupdate_match.match`)

Für jedes Spiel, das auf einem Court liegt (wie heute).

| Feld | Inhalt | Quelle | Status |
| --- | --- | --- | --- |
| `_id`, `n`, `p0`, `p1`, `s`, `sf` | ID, Name, Spieler, Stand, Zählweise | `setup`, `network_score` | heute (Original) |
| `d` | Doppel | `setup.is_doubles` | heute (Patch) |
| `ts` | Team 1 schlägt auf | `network_team1_serving` | heute (Patch) |
| `pe` | je Team: Spieler 1 im rechten Feld | `network_teams_player1_even` | heute (Patch) |
| `dur` | Spieldauer in ms | `duration_ms` | heute (Patch) |
| `c0`, `c1` | Verein je Spieler | `teams[].players[].club` | heute (Patch) |
| `n0`, `n1` | Nation je Spieler (IOC-Code) | `teams[].players[].nationality` | heute (Patch) |
| `di` | Feld (Draw) des Spiels | `setup.draw_id` | heute (Patch) |
| `id0`, `id1` | Spieler-IDs je Team (stabil, z. B. BTP-ID) | `btp_player_ids` bzw. `players[].btp_id` | **neu** |
| `mn` | Spielnummer | `setup.match_num` | **neu** (für Courts) |
| `called_ts` | Aufruf auf den Court (ms) | Zeitpunkt `now_on_court` gesetzt | **neu** |
| `start_ts` | Spielbeginn (ms), z. B. „love-all“ am Tablet | aus bup (`presses`/`metadata.start`), falls BTS es speichert | **neu** |
| `end_ts` | Spielende (ms) | `end_ts` | **neu** |
| `w` | Sieger (`true` = Team 1) | `team1_won` | **neu** |
| `ss` | Ergebnisart: `normal`, `retired`, `walkover`, `disqualified`, `no_match` | `score_status` | **neu** |
| `ump`, `sj` | Schiedsrichter, Aufschlagrichter (Name) | `setup.umpire.name`, `setup.service_judge.name` | **neu** |
| `t`, `dt` | angesetzte Zeit, Datum | `setup.scheduled_time_str`, `scheduled_date` | **neu** (für Courts) |
| `cards` | Karten: `[{ team, player, type: 'yellow'/'red'/'black', ts }]` | `marks` von bup | **neu**, optional |

**`tupdate_match`** sollte bei jedem Punkt `_id`, `s`, `ts`, `pe`, `dur` schicken (heute so) und
zusätzlich `w`, `ss`, `end_ts`, sobald das Spiel entschieden ist.

**Wichtig für `pe`:** Bei einem neuen Satz ist `pe` erst bekannt, wenn am Tablet Aufschläger und
Rückschläger gewählt sind – bis dahin bitte `[null, null]` schicken (wie bup), nicht weglassen.

## 5. Alle Felder mit allen Spielen (`tset.event.draws[]`)

Das ist die Grundlage für Turnierbäume, Gruppen, vollständige Ergebnisse und Statistik.
Heute schickt der Patch eine flache Liste aller Spiele mit Feld-Angaben. Für alle Feldarten
sicher wäre eine **Liste der Felder mit ihren Knoten**:

```js
draws: [{
  id: '17',                    // setup.draw_id
  name: 'DE U17',              // setup.draw_name
  event: 'DE U17',             // Disziplin (event.Name)
  event_id: '4',               // neu: Disziplin-ID, fasst Haupt-, Quali-, Trostfeld zusammen
  stage: 'Hauptfeld',          // setup.stage_name
  stage_type: 1,               // setup.stage_type
  stage_order: 2,              // setup.stage_display_order
  position: 1,                 // setup.draw_position (Platzierungsfelder > 1)
  type: 'ko',                  // neu: 'ko' | 'group' | 'qualification' | 'consolation' | 'double_ko'
  size: 32,                    // neu: Feldgröße (draw.Size)
  is_doubles: false,
  nodes: [ … ],                // alle Positionen, siehe unten
  rankings: [ … ],             // Gruppen/Endplatzierung, siehe unten
}]
```

### 5.1 Knoten (`nodes[]`) – auch Freilose und Einstiegspositionen

BTS übernimmt heute nur echte Spiele (`IsMatch`). Für den Baum fehlen dadurch **Freilose** und
die **Einstiegspositionen der ersten Runde** (gesetzte Spieler, Qualifikanten). Der Ticker leitet
sie heute ab, sicher ist es nur mit allen Knoten aus BTP (`PlanningID` je Feld):

| Feld | Inhalt | Quelle (BTP) | Status |
| --- | --- | --- | --- |
| `pl` | Planungsnummer (Position im Feld) | `PlanningID` | heute (Patch) |
| `_id` | Spiel-ID, falls der Knoten ein Spiel ist | `match._id` | heute (Patch) |
| `is_match` | echtes Spiel? (sonst Freilos/Eintrag) | `IsMatch` | **neu** |
| `bye` | Freilos | `IsMatch=false` und nur ein Eintrag | **neu** |
| `mn` | Spielnummer (auch bei Freilosen, BTP nummeriert mit) | `MatchNr` | heute (nur Spiele) |
| `r`, `ph` | Runde (`R32`, `VF`, `HF`, `Finale`, `3/4`, `G1` …) | `match_name`, `phase_name_raw` | heute (Patch) |
| `f1`, `f2` | Herkunft der beiden Teams (Planungsnummern) | `From1`, `From2` | heute (Patch) |
| `wt`, `lt` | Sieger / Verlierer geht in Knoten | `WinnerTo`, `LoserTo` | heute (Patch) |
| `from1_link`, `from2_link` | aufgelöste Herkunft über Feldgrenzen (Quali → Hauptfeld, Gruppe → KO) | `setup.links.from*_link` | **neu** |
| `p0`, `p1`, `c0`, `c1`, `n0`, `n1` | Spieler, Vereine, Nationen | `setup.teams` | heute (Patch) |
| `id0`, `id1` | Spieler-IDs | `players[].btp_id` | **neu** |
| `seed0`, `seed1` | Setzung (z. B. `1`, `3/4`) | `stage_entry.Seed1/Seed2` | **neu** |
| `q0`, `q1` | Platzhalter-Text, wenn noch offen (z. B. „Sieger Gruppe A“, „Q1“) | `from*_link` | **neu** |
| `s`, `w`, `ss` | Ergebnis, Sieger, Ergebnisart | `network_score`, `team1_won`, `score_status` | heute (`s`, `w`), `ss` **neu** |
| `st` | Zustand (`scheduled`, `preparation`, `oncourt`, `finished` …) | `setup.state` | heute (Patch) |
| `t`, `dt` | angesetzte Zeit, Datum | `scheduled_time_str`, `scheduled_date` | heute (Patch) |
| `court` | Court-Nummer, wenn angesetzt/gespielt | `setup.court_id` → `court.num` | **neu** |
| `start_ts`, `end_ts`, `dur` | Beginn, Ende, Dauer | `metadata.start`, `end_ts`, `duration_ms` | **neu** |

### 5.2 Platzierungen (`rankings[]`)

| Feld | Inhalt | Quelle | Status |
| --- | --- | --- | --- |
| `p` | Platz | `node.Rank` / `btp_group_rankings.place_from` | heute (Patch, nur Gruppen) |
| `n`, `c`, `nat`, `ids` | Spieler, Vereine, Nationen, IDs | `team.players` | heute (`n`, `c`), Rest **neu** |
| `won`, `lost`, `sets`, `points` | Bilanz, wie in BTP berechnet | BTP-Gruppentabelle | **neu**, optional |

Damit stimmt die Gruppentabelle im Ticker genau mit BTP überein (Tiebreak-Regeln!), statt dass der
Ticker sie selbst nachrechnet.

## 6. Die nächsten Spiele (`tset.event.upcoming[]`)

Heute (Patch): die nächsten 60 Spiele in Vorbereitung bzw. geplant – `_id`, `n`, `p0`, `p1`,
`c0`, `c1`, `n0`, `n1`, `t`, `dt`, `st`, `mn`, `di`. **Neu** wünschenswert:

| Feld | Inhalt | Quelle |
| --- | --- | --- |
| `court` | schon zugewiesener Court | `setup.court_id` |
| `id0`, `id1` | Spieler-IDs | `players[].btp_id` |
| `rest` | frühester Beginn wegen Pausenzeit (ms), falls BTS das kennt | Ruhezeiten / Auto-Aufruf |
| `checked_in` | Check-in je Spieler | `players[].checked_in` |

Wenn BTS ohnehin eine **Aufrufreihenfolge** (Auto-Call) berechnet, wäre deren Reihenfolge besser als
die Sortierung nach Planzeit – dann stimmen „Als Nächstes“ und die Zeitschätzung genauer.

## 7. Spieler (neu, optional: `tset.event.players[]`)

Eine Liste aller Spieler des Turniers vermeidet Doppelungen bei gleichen Namen:
`[{ id, name, first, last, club, nat, gender }]`. In Spielen und Knoten reichen dann die IDs.

## 8. Wann was geschickt wird

| Ereignis | Nachricht |
| --- | --- |
| Verbindung aufgebaut | `tset` (Gesamtstand inkl. `draws`, `upcoming`) |
| Spiel kommt auf / verlässt einen Court, Aufruf | `tset` (wie heute über `pushall`) |
| Punkt, Aufschlag, Positionen | `tupdate_match` |
| Ergebnis in BTP eingetragen / BTP-Sync ändert Felder | `tset` – oder neu `tdraws` (nur `draws`) |
| Zeitplan in BTP geändert | `tset` (wegen `upcoming`, `t`/`dt`) |

Für große Turniere optional: `tdraws` mit `{ version, draws }` nur, wenn sich an den Feldern etwas
geändert hat, und `tset` dann ohne `draws`. Der Ticker unterstützt beides.

## 9. Sonderfälle, die der Ticker abdecken soll

- **Freilose** in Runde 1 (heute abgeleitet, sicher mit `bye`/`is_match` aus 5.1)
- **Qualifikation → Hauptfeld** und **Gruppe → KO** (Platzhalter `q0/q1`, `from*_link`)
- **Platzierungsspiele** (3/4, 5/8 …) und **Trostrunden** (`loser_to`, `type: 'consolation'`)
- **Doppel-KO** (`type: 'double_ko'`, Verliererbaum über `lt`)
- **Aufgabe / w.o. / Disqualifikation** (`ss`) – im Baum als „w.o.“ bzw. „Aufg.“ statt Satzergebnis
- **Mehrere Hallen / Turniertage** (`location`, `days`, `dt`)
- **Mannschaftsturniere / Liga** (`team_competition`): falls relevant, später eigener Abschnitt

## 10. Test

Der Ticker bringt einen Simulator mit (`tools/fake-bts.js`), der genau dieses Format spricht.
Für die Abstimmung reicht ein Export eines echten `tset` (z. B. als JSON-Datei) aus einem
Test-Turnier mit KO-Feld, Gruppe, Qualifikation und Trostrunde – damit prüfen wir den Ticker,
bevor es in ein echtes Turnier geht.

Kontakt Liveticker: Frank Juchim · Repo: https://github.com/frankjuchim/bts-liveticker-v2
