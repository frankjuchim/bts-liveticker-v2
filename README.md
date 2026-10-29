# BTS Liveticker

Öffentlicher **Turnier-Liveticker** und **Stream-Overlays (OBS)** für die Badminton-Turniersoftware
**BTS** (Badminton Tournament System). Läuft als kleiner Container auf einem **Proxmox**-Server.

- Liveticker für Zuschauer: alle Courts mit Spielstand, Ergebnisliste, Suche nach Spieler/Disziplin
- Transparente Overlays für den Stream, einzeln pro Court oder mehrere Courts auf einmal
- **Spielern und Vereinen folgen:** antippen, oben „Meine Spieler“, Hinweise bei Aufruf,
  „Gleich dran“ und Spielende; eigene Seite `/spieler` mit allen Spielern, Vereinen und Statistik
- **Ergebnis-Einblendung** für den Stream (Bauchbinde bei Spielende oder Laufband)
- Mit einer kleinen [BTS-Erweiterung](docs/BTS-UPGRADE.md), die **auf der BTS-Maschine**
  eingespielt wird: Aufschläger/Rückschläger, Spielfeld-Ansicht wie in bup, **Vereine**,
  **Spieldauer** und **„Als Nächstes“** (Spiele in Vorbereitung und geplante Spiele)
  mit **Zeitplan-Schätzung**: aktueller Verzug zum Zeitplan (aus den zuletzt aufgerufenen
  Spielen) und voraussichtlicher Beginn der nächsten Spiele (aus der bisherigen Courtbelegung,
  Einzel/Doppel getrennt, der Reihenfolge der Ansetzung und den Pausen der Spieler) – auf der
  Seite als unverbindliche Schätzung gekennzeichnet
- Titel, Farbe und Logo im Admin-Panel einstellbar; Turniername und Turnierlogo kommen aus BTS
- Keine Datenbank, keine Cloud: Node.js + eine JSON-Datei

```
 BTS (Halle)                          Proxmox: LXC-Container              Zuschauer / OBS
 ┌──────────────┐  WebSocket          ┌────────────────────────┐   HTTP  ┌───────────────┐
 │ Ticker aktiv │ ──────────────────► │ bts-liveticker (Node)  │ ──────► │ /  /court/1 … │
 └──────────────┘  /ws/update         └────────────────────────┘   SSE   └───────────────┘
```

Der Server spricht dasselbe Ticker-Protokoll wie der Ticker aus dem BTS-Repo. BTS muss
**nicht** geändert werden – für Aufschlag, Vereine, Spieldauer und „Als Nächstes“ gibt es eine
optionale Erweiterung.

## Installation auf Proxmox

Auf dem **Proxmox-Host** als root (Shell im Web-UI: *Datacenter → Knoten → Shell*):

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/deploy/proxmox-create-lxc.sh)"
```

Voraussetzung: Proxmox VE 8 oder neuer (7.4 mit allen Updates sollte auch gehen). Das Skript lädt eine Debian-12-Vorlage, legt einen unprivilegierten LXC-Container an
(1 Kern, 512 MB RAM, 4 GB Platte, DHCP, startet mit dem Host) und installiert den Liveticker.
Am Ende stehen Adresse, Ticker-Passwort und das Admin-Passwort (`btsliveadmin`, bitte gleich
ändern) im Terminal.

Einstellungen über Variablen, z. B. feste IP und anderer Speicher:

```sh
CTID=120 IP=192.168.1.50/24 GW=192.168.1.1 STORAGE=local-zfs \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/deploy/proxmox-create-lxc.sh)"
```

| Variable | Standard | |
| --- | --- | --- |
| `CTID` | nächste freie ID | Container-ID |
| `CT_HOSTNAME` | `bts-liveticker` | Hostname |
| `STORAGE` | `local-lvm` | Speicher für die Container-Platte |
| `TEMPLATE_STORAGE` | `local` | Speicher für die Debian-Vorlage |
| `BRIDGE` | `vmbr0` | Netzwerkbrücke |
| `IP` / `GW` | `dhcp` | z. B. `192.168.1.50/24` und Gateway |
| `VLAN` | – | VLAN-Tag |
| `ROOT_PASSWORD` | zufällig | root-Passwort für die Container-Konsole (wird am Ende angezeigt) |
| `DEBIAN` | `12` | Debian-Version des Containers (`13` nur mit aktuellem Proxmox) |
| `DISK` / `MEMORY` | `4` / `512` | GB / MB |

**Schon einen Container?** (Debian 12 oder 13, Ubuntu 24.04; auch eine VM geht) – darin als root:

```sh
apt-get update && apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/deploy/install.sh | bash
```

### Update

Konfiguration, Passwörter, Logo, Farben und gespeicherte Ergebnisse bleiben bei einem Update
erhalten; BTS verbindet sich danach von selbst wieder.

**Im Admin-Panel (am einfachsten):** Abschnitt **„Update“** zeigt die installierte und die
neueste Version mit den Änderungen. **„Jetzt aktualisieren“** holt den neuen Stand von GitHub,
startet den Liveticker neu (etwa eine Minute nicht erreichbar) und zeigt dabei das Protokoll.
Technisch legt der Liveticker (läuft ohne root-Rechte) nur eine Anfrage-Datei an; die
systemd-Einheit `bts-liveticker-update.path` startet daraufhin `deploy/update.sh` als root.
Den Knopf gibt es ab dieser Version – **ältere Installationen einmalig per Befehl
aktualisieren** (siehe unten), danach geht es per Knopf.

**Vom Proxmox-Host aus:** im Web-UI *Datacenter → Knoten → Shell* öffnen und

```sh
pct exec <CTID> -- bash /opt/bts-liveticker/deploy/update.sh
```

`<CTID>` ist die Nummer des Containers (im Web-UI links vor dem Namen, z. B. `105 (bts-liveticker)`,
oder `pct list`).

**Im Container selbst** (z. B. nach `pct enter <CTID>` oder per SSH) als root:

```sh
bash /opt/bts-liveticker/deploy/update.sh
```

### Root-Login im Container

Die *Konsole* des Containers im Web-UI fragt nach einem Login: Benutzer `root`, das Passwort
zeigt das Proxmox-Skript am Ende der Installation an (oder vorher selbst festlegen mit
`ROOT_PASSWORD=…`).

Passwort vergessen, oder Container mit einer älteren Skript-Version angelegt (die noch kein
Passwort gesetzt hat)? In der Shell des Proxmox-Hosts (*Datacenter → Knoten → Shell*):

```sh
pct enter <CTID>   # ohne Passwort direkt in den Container
passwd             # neues root-Passwort setzen
exit
```

Welche Version läuft? `pct exec <CTID> -- git -C /opt/bts-liveticker log -1 --format='%h %cd %s' --date=short`

Debian-Updates im Container (Sicherheitsupdates) gehen wie üblich:
`pct exec <CTID> -- bash -c "apt update && apt -y upgrade"`

## Admin-Panel

`http://<IP>/admin` ist durch ein **Admin-Passwort** geschützt.

- **Standardpasswort: `btsliveadmin`** – gilt bei neuen Installationen und nach dem Update
  bestehender Systeme, bis es geändert wird. Solange es aktiv ist, zeigt das Admin-Panel oben
  einen Hinweis.
- **Ändern:** nach dem Anmelden unten im Abschnitt **„Admin-Passwort ändern“** (mindestens
  8 Zeichen). Andere angemeldete Browser werden dabei abgemeldet.
- Angemeldet bleibt man 7 Tage (bzw. bis „Abmelden“ oder einem Neustart des Dienstes).
  Nach 10 falschen Versuchen innerhalb von 15 Minuten wird die Anmeldung von dieser
  Adresse für 15 Minuten gesperrt.
- Gespeichert wird nur ein Hash des Passworts in `/var/lib/bts-liveticker/admin.json`.
- Alternativ lässt sich das Passwort fest über `ADMIN_PASSWORD` in `/etc/bts-liveticker.env`
  vorgeben – es gilt dann statt `btsliveadmin` und ist im Admin-Panel nicht änderbar.

**Admin-Passwort vergessen?** Auf dem Proxmox-Host zurück auf `btsliveadmin` setzen:

```sh
pct exec <CTID> -- bash -c "rm -f /var/lib/bts-liveticker/admin.json && systemctl restart bts-liveticker"
```

Das **Ticker-Passwort** (für BTS) ist ein anderes: Es steht in `/etc/bts-liveticker.env` und
lässt sich im Admin-Panel unter „Einrichtung in BTS“ anzeigen.

### Erscheinungsbild und Link

Im Admin-Panel unter **Erscheinungsbild**:

1. Optional ein **Design** wählen (fertiges Paket aus Titel, Farbe und Logo – nur sichtbar, wenn
   unter [designs/](designs/README.md) welche angelegt sind).
1. Titel, Untertitel, **Link zu allen Spielen** und **Farbe** ändern – Farbe aus zehn Vorgaben
   oder frei per Farbwähler/Hex-Wert, mit Vorschau.
2. **Speichern** klicken. Solange etwas nicht gespeichert ist, steht dort
   „Nicht gespeicherte Änderungen“.

Ein **Logo** wird sofort beim Hochladen gespeichert (PNG, JPG, WebP oder SVG bis 10 MB, am besten
mit transparentem Hintergrund; große Bilder verkleinert der Browser vorher auf Logo-Größe). Offene Ticker-Seiten und OBS-Overlays übernehmen alles sofort,
ohne Neuladen. „Auf Standard zurücksetzen“ nimmt wieder die Werte aus der Konfigurationsdatei
bzw. den Link von BTS. Gespeichert wird in `/var/lib/bts-liveticker/settings.json` und `logo.*` –
das bleibt auch bei Neustarts und Updates erhalten.

**Link zu allen Spielen:** BTS schickt einen Link zu turnier.de mit, aber nur korrekt, wenn in
BTS die „Turnier Guid“ eingetragen ist – und immer mit `www.turnier.de`. Liegt das Turnier z. B.
auf `dbv.turnier.de`, einfach die Adresse der Turnierseite ins Feld kopieren
(z. B. `https://dbv.turnier.de/tournament/<GUID>/matches`) oder den Link ausblenden.

**Ticker-Passwort nachsehen** (ohne Admin-Panel), auf dem Proxmox-Host:
`pct exec <CTID> -- grep TICKER_PASSWORD /etc/bts-liveticker.env` – gilt, solange es nicht im Admin-Panel
geändert wurde (dann steht es in `/var/lib/bts-liveticker/ticker-password.json`).

## Konfiguration

`/etc/bts-liveticker.env` im Container, danach `systemctl restart bts-liveticker`.
`TITLE`, `SUBTITLE` und `ACCENT` sind die Standardwerte – im Admin-Panel geänderte Werte
haben Vorrang:

| Variable | Standard | |
| --- | --- | --- |
| `TICKER_PASSWORD` | zufällig erzeugt | Passwort, das in BTS eingetragen wird (im Admin-Panel änderbar; dort gesetzt, geht es vor) |
| `PORT` | `80` | HTTP-Port |
| `TITLE` | `Badminton` | Überschrift im Kopf, z. B. Vereinsname |
| `SUBTITLE` | `Turnier-Liveticker` | Zeile darunter |
| `DESIGN` | `standard` | Voreingestelltes Design (siehe [designs/](designs/README.md)) |
| `ADMIN_PASSWORD` | – | Festes Admin-Passwort; dann im Admin-Panel nicht änderbar |
| `ACCENT` | `#1f5f99` | Akzentfarbe (Kopf, Court-Karten, Overlays), z. B. Vereinsfarbe |
| `LOGO_FILE` | – | Pfad zu einem eigenen Logo |
| `DATA_DIR` | `/var/lib/bts-liveticker` | gespeicherter Stand |

Logo: am einfachsten im Admin-Panel hochladen. Ohne Logo erscheint ein Federball-Symbol.

Log ansehen: `journalctl -u bts-liveticker -f`

## BTS verbinden

In BTS: Turnier bearbeiten → **Ticker** aktivieren →

- **Ticker-Adresse:** `ws://<IP-des-Containers>/ws/update`
  (mit HTTPS über einen Reverse-Proxy: `wss://<domain>/ws/update`)
- **Ticker-Passwort:** steht im Admin-Panel und lässt sich dort ändern (Abschnitt „Ticker-Passwort für BTS“);
  Standard ist `TICKER_PASSWORD` aus der Konfiguration

Auf `http://<IP>/admin` steht danach „verbunden“. Dort gibt es auch alle Overlay-Links.

### BTS-Erweiterung v2 (optional)

Der Liveticker funktioniert mit jedem unveränderten BTS. Eine kleine Erweiterung lässt BTS
zusätzliche Daten mitschicken, die es ohnehin kennt:

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

Geändert wird nur die Datei `bts/ticker_conn.js` (die Ticker-Anbindung): BTS schickt
zusätzliche Felder mit, Bedienung, Datenbank und alle anderen Funktionen von BTS bleiben
unverändert. Die Änderung wird als lokaler Git-Commit gespeichert, bleibt bei BTS-Updates
(`git pull`) erhalten und lässt sich wieder entfernen.

Sie wird **nicht hier im Liveticker-Container** eingespielt, sondern **auf der Maschine, auf
der BTS läuft** – dort im BTS-Verzeichnis, danach BTS neu starten:

```sh
curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/bts-patch/apply.sh | bash
```

Schritt für Schritt (wie man auf die BTS-Maschine kommt, wo das BTS-Verzeichnis liegt, was
bei BTS-Updates passiert): **[docs/BTS-UPGRADE.md](docs/BTS-UPGRADE.md)**.
`/admin` zeigt unter „BTS-Erweiterung“, ob sie aktiv ist („v2“ oder „ältere Version“ – dann
den Befehl erneut ausführen, er aktualisiert).

## Von außen erreichbar machen

Im Hallen-/Vereinsnetz reicht die IP des Containers. Sollen Zuschauer von unterwegs
zusehen, braucht es eine öffentliche Adresse mit HTTPS, z. B.:

- **Reverse-Proxy** (Nginx Proxy Manager, Caddy, Traefik, …) auf den Container, Port 80.
  Wichtig: **WebSocket-Unterstützung** einschalten (bei Nginx Proxy Manager: „Websockets Support“)
  und für den Logo-Upload größere Uploads erlauben (Nginx Proxy Manager: unter *Advanced*
  `client_max_body_size 20m;` eintragen).
  Nginx-Beispiel:
  ```nginx
  location / {
      proxy_pass http://192.168.1.50;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_buffering off;          # für die Live-Updates (Server-Sent Events)
      proxy_read_timeout 1h;
      client_max_body_size 20m;     # Logo-Upload im Admin-Panel
  }
  ```
- **Cloudflare Tunnel** (ohne Portfreigabe): `cloudflared` im Container installieren und
  einen Public Hostname auf `http://localhost:80` zeigen lassen – WebSockets gehen dort von selbst.

## Seiten

| URL | Inhalt |
| --- | --- |
| `/` | Liveticker für Zuschauer |
| `/court/<nr>` | Overlay für einen Court (transparenter Hintergrund) |
| `/courts` | Overlay mehrerer Courts (Standard: alle belegten untereinander) |
| `/?view=field` | Liveticker in der **Spielfeld-Ansicht** (wie in bup, umschaltbar auf der Seite) |
| `/spieler` | **Meine Spieler**, alle Spieler, Vereine, Statistik (nach dem Vorbild des EM-Tickers) |
| `/ergebnis` | Overlay: Bauchbinde bei Spielende (`?mode=bar` Laufband, `?test=1` zum Einrichten) |
| `/feld/<nr>` | Großes Spielfeld eines Courts, z. B. für einen Bildschirm in der Halle |
| `/felder?cols=3` | Alle Courts als Spielfeld im Raster; `cols` = Spalten (die Breite ergibt sich daraus), `c=1,2` nur diese Courts, `frei=0` freie Courts ausblenden |
| `/admin` | Mit Passwort: Verbindungsstatus, Overlay-Links, Erscheinungsbild/Logo/Link, Ergebnisse zurücksetzen |
| `/api/state` | Aktueller Stand als JSON |

### Parameter für die Overlays

| Parameter | Wirkung | Beispiel |
| --- | --- | --- |
| `c` | Nur bestimmte Courts (`/courts`) | `/courts?c=1,2` |
| `layout=split` | Erster Court links, zweiter rechts (`/courts`) | `/courts?layout=split&c=1,2` |
| `cols` | Raster mit mehreren Spalten (`/courts`) | `/courts?cols=2` |
| `pos=bottom` | Leiste unten statt oben (`/courts`) | `/courts?pos=bottom` |
| `scale` | Größe skalieren | `?scale=1.5` |
| `names=full` | Volle Vornamen statt „M. Mustermann“ | `?names=full` |
| `sets=0` | Abgeschlossene Sätze ausblenden | `?sets=0` |
| `linger` | Minuten, die ein beendetes Spiel nach Freigabe des Courts stehen bleibt (Standard 5) | `?linger=0` |
| `showIdle=1` | Freien Court als „Kein laufendes Spiel“ zeigen | `?showIdle=1` |
| `bg` | Hintergrundfarbe (z. B. Chroma-Key) | `?bg=00ff00` |

In OBS: *Quelle hinzufügen → Browser*, URL eintragen, 1920 × 1080.

Anzeige: Spalten = abgeschlossene Sätze, weißes Feld = Punkte im laufenden Satz,
✓ = Sieger, Punkt = Aufschläger, unterstrichen = Rückschläger (Doppel), „Gleich“ =
Spiel aufgerufen, aber noch ohne Punkte.

### Spielern folgen

Im Liveticker auf einen **Namen tippen** (oder oben „Spieler hinzufügen“) – der Spieler steht
dann mit Stern unter **„Meine Spieler“**: laufendes Spiel, als Nächstes (mit Erweiterung) und
zuletzt gespielt; seine Karten sind gelb umrandet. Auf `/spieler` lassen sich auch ganze
**Vereine** folgen. Die Liste bleibt im Browser gespeichert (kein Konto, nichts auf dem Server).

Hinweise erscheinen auf der Seite, wenn ein gefolgter Spieler **aufgerufen** wird, **gleich
dran** ist oder sein Spiel **endet**. Mit „Benachrichtigungen einschalten“ kommen sie auch als
Browser-Benachrichtigung, solange die Seite geöffnet ist (nur über HTTPS möglich).

`/spieler` (nach dem Vorbild des [EM-Tickers](https://cvpcvp.github.io/esc26/)):
**Meine Spieler** (je Spieler: jetzt, als Nächstes, Ergebnisse mit Dauer, Bilanz),
**Alle Spieler** (Suche, Verein, Bilanz), **Vereine** (Spieler, Bilanz, wer gerade spielt),
**Statistik** (Spiele, Spielzeit, längstes/kürzestes Spiel, meiste Punkte, längster Satz,
meiste Siege).

### Ergebnis-Einblendung (Stream)

`/ergebnis` als OBS-Browserquelle (1920 × 1080): Endet ein Spiel, erscheint unten eine
Bauchbinde mit Sieger, Satzergebnissen und Gegner (mit Erweiterung auch Vereinen). Mehrere
Spielenden kommen nacheinander.

| Parameter | Wirkung |
| --- | --- |
| `mode=bar` | Laufband mit den letzten Ergebnissen statt Bauchbinde |
| `c=1,2` | nur Spiele dieser Courts |
| `dauer=12` | Sekunden pro Einblendung |
| `anzahl=8` | Ergebnisse im Laufband |
| `pos=top` | oben statt unten |
| `test=1` | sofort das letzte Ergebnis zeigen (zum Einrichten) |
| `names=full`, `scale`, `bg` | wie bei den anderen Overlays |

### Zeitplan-Schätzung

Mit der BTS-Erweiterung v2 zeigt der Ticker oben den **Verzug zum Zeitplan** („ca. 25 min
Verzug“) und bei „Als Nächstes“ den **voraussichtlichen Beginn** jedes Spiels („ca. 14:45“,
darunter die angesetzte Zeit), ebenso auf der Spielerseite und in den Hinweisen für gefolgte
Spieler. Grundlage:

- **Verzug:** Median aus Aufruf minus Ansetzung der zuletzt aufgerufenen Spiele (bis zu 8,
  aus den letzten 4 Stunden)
- **Courtbelegung je Spiel:** vom Aufruf bis der Court frei ist, Einzel und Doppel getrennt
  (ersatzweise Spieldauer + 8 min; anfangs 30 bzw. 35 min)
- **Beginn:** die nächsten Spiele in der Reihenfolge der Ansetzung auf die frei werdenden
  Courts verteilt; Spieler, die noch spielen, frühestens 5 min nach ihrem Spielende; nie früher
  als angesetzt (außer schon in Vorbereitung); nur Spiele des aktuellen Tages

Für Proben und Simulationen vor dem Turniertag gibt es im Admin-Panel einen **Testmodus**: Die
Schätzung ignoriert dann das Datum der Ansetzungen (nur die Uhrzeit zählt), und der Status zeigt
die Aufschlagdaten je Court zur Fehlersuche. Im Turnierbetrieb ausschalten.

Auf der Seite steht ausdrücklich, dass es **unverbindliche Schätzungen** sind und allein der
Aufruf der Turnierleitung zählt. Die Ansetzung eines Spiels kennt der Ticker erst, wenn er es
unter „Als Nächstes“ gesehen hat – nach dem Einspielen dauert es daher ein paar Aufrufe, bis
der Verzug erscheint.

### Spielfeld-Ansicht

Wie die Eingabeansicht in bup: das Feld von oben, die Spieler in ihren Aufschlagfeldern, ein
Pfeil vom Aufschläger zum Rückschläger (wird bei jedem neuen Ballwechsel neu gezeichnet) und der
Punktestand am Netz. Braucht die [BTS-Erweiterung](docs/BTS-UPGRADE.md): Solange der Liveticker sie nicht erkennt
(Anzeige im Admin-Panel unter „BTS-Erweiterung“), ist der Knopf „Spielfeld“ ausgegraut und
`/feld/<nr>` zeigt einen Hinweis.

Seiten: Heim beginnt im ersten Satz links, nach jedem Satz wird gewechselt, im Entscheidungssatz
zusätzlich, sobald ein Team 11 Punkte hat (bei Sätzen bis 11: 6). BTS meldet die tatsächliche
Hallenseite nicht – die Ansicht folgt deshalb dieser Regel.

## Was BTS schickt

- `tset` – alle Courts und die Spiele darauf, Turniername, turnier.de-Link, Turnierlogo
- `tupdate_match` – neuer Spielstand eines Spiels (bei jedem Punkt)
- mit Erweiterung v2 zusätzlich: Aufschlag und Positionen, Doppel, Vereine, Spieldauer und
  in `tset` die nächsten Spiele mit Ansetzung (Details in [docs/BTS-UPGRADE.md](docs/BTS-UPGRADE.md))

BTS schickt nur Spiele, die gerade auf einem Court liegen. Der Liveticker merkt sich deshalb
jedes Spiel, das einmal auf einem Court war, und baut daraus die Ergebnisliste (max. 400 Spiele).
Wechselt der Turniername in BTS, wird die Liste automatisch geleert; sonst über `/admin`.

## Entwicklung

```sh
npm install
PORT=8080 TICKER_PASSWORD=test node server.js
node tools/fake-bts.js ws://localhost:8080/ws/update test   # simuliert BTS mit 4 Courts
npm test
```
