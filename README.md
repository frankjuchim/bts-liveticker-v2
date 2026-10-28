# BTS Liveticker

Öffentlicher **Turnier-Liveticker** und **Stream-Overlays (OBS)** für die Badminton-Turniersoftware
**BTS** (Badminton Tournament System). Läuft als kleiner Container auf einem **Proxmox**-Server.

- Liveticker für Zuschauer: alle Courts mit Spielstand, Ergebnisliste, Suche nach Spieler/Disziplin
- Transparente Overlays für den Stream, einzeln pro Court oder mehrere Courts auf einmal
- Aufschläger (Punkt) und im Doppel Rückschläger (unterstrichen) – mit einer kleinen
  [BTS-Erweiterung](docs/BTS-UPGRADE.md), die **auf der BTS-Maschine** eingespielt wird
- Titel, Farbe und Logo im Admin-Panel einstellbar; Turniername und Turnierlogo kommen aus BTS
- Keine Datenbank, keine Cloud: Node.js + eine JSON-Datei

```
 BTS (Halle)                          Proxmox: LXC-Container              Zuschauer / OBS
 ┌──────────────┐  WebSocket          ┌────────────────────────┐   HTTP  ┌───────────────┐
 │ Ticker aktiv │ ──────────────────► │ bts-liveticker (Node)  │ ──────► │ /  /court/1 … │
 └──────────────┘  /ws/update         └────────────────────────┘   SSE   └───────────────┘
```

Der Server spricht dasselbe Ticker-Protokoll wie der Ticker aus dem BTS-Repo. BTS muss
**nicht** geändert werden – nur für die Aufschlaganzeige gibt es eine optionale Erweiterung.

## Installation auf Proxmox

Auf dem **Proxmox-Host** als root (Shell im Web-UI: *Datacenter → Knoten → Shell*):

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/deploy/proxmox-create-lxc.sh)"
```

Voraussetzung: Proxmox VE 8 oder neuer (7.4 mit allen Updates sollte auch gehen). Das Skript lädt eine Debian-12-Vorlage, legt einen unprivilegierten LXC-Container an
(1 Kern, 512 MB RAM, 4 GB Platte, DHCP, startet mit dem Host) und installiert den Liveticker.
Am Ende stehen Adresse und Ticker-Passwort im Terminal.

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

Neue Versionen holt man mit einem Befehl. Konfiguration, Passwort, Logo, Farben und
gespeicherte Ergebnisse bleiben erhalten; BTS verbindet sich danach von selbst wieder.

**Vom Proxmox-Host aus (empfohlen):** im Web-UI *Datacenter → Knoten → Shell* öffnen und

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

## Erscheinungsbild und Link im Admin-Panel

Unter `http://<IP>/admin` → **Erscheinungsbild**:

1. **Ticker-Passwort** oben eintragen (nötig zum Speichern).
2. Titel, Untertitel, **Link zu allen Spielen** und **Farbe** ändern – Farbe aus zehn Vorgaben
   oder frei per Farbwähler/Hex-Wert, mit Vorschau.
3. **Speichern** klicken. Solange etwas nicht gespeichert ist, steht dort
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

**Passwort vergessen?** Auf dem Proxmox-Host:
`pct exec <CTID> -- grep TICKER_PASSWORD /etc/bts-liveticker.env`

## Konfiguration

`/etc/bts-liveticker.env` im Container, danach `systemctl restart bts-liveticker`.
`TITLE`, `SUBTITLE` und `ACCENT` sind die Standardwerte – im Admin-Panel geänderte Werte
haben Vorrang:

| Variable | Standard | |
| --- | --- | --- |
| `TICKER_PASSWORD` | zufällig erzeugt | Passwort, das in BTS eingetragen wird |
| `PORT` | `80` | HTTP-Port |
| `TITLE` | `Badminton` | Überschrift im Kopf, z. B. Vereinsname |
| `SUBTITLE` | `Turnier-Liveticker` | Zeile darunter |
| `ACCENT` | `#1f5f99` | Akzentfarbe (Kopf, Court-Karten, Overlays), z. B. Vereinsfarbe |
| `LOGO_FILE` | – | Pfad zu einem eigenen Logo |
| `DATA_DIR` | `/var/lib/bts-liveticker` | gespeicherter Stand |

Logo: am einfachsten im Admin-Panel hochladen. Ohne Logo erscheint ein Federball-Symbol.

Log ansehen: `journalctl -u bts-liveticker -f`

## BTS verbinden

In BTS: Turnier bearbeiten → **Ticker** aktivieren →

- **Ticker-Adresse:** `ws://<IP-des-Containers>/ws/update`
  (mit HTTPS über einen Reverse-Proxy: `wss://<domain>/ws/update`)
- **Ticker-Passwort:** `TICKER_PASSWORD` aus der Konfiguration

Auf `http://<IP>/admin` steht danach „verbunden“. Dort gibt es auch alle Overlay-Links.

### Aufschläger/Rückschläger (optional)

Dafür braucht **BTS** eine kleine Erweiterung. Sie wird **nicht hier im Liveticker-Container**
eingespielt, sondern **auf der Maschine, auf der BTS läuft** – dort im BTS-Verzeichnis:

```sh
curl -fsSL https://raw.githubusercontent.com/frankjuchim/bts-liveticker-v2/main/bts-patch/apply.sh | bash
```

Schritt für Schritt (wie man auf die BTS-Maschine kommt, wo das BTS-Verzeichnis liegt, was
bei BTS-Updates passiert): **[docs/BTS-UPGRADE.md](docs/BTS-UPGRADE.md)**.
`/admin` zeigt unter „Aufschlaganzeige“, ob die Erweiterung aktiv ist.

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
| `/admin` | Verbindungsstatus, Overlay-Links, Erscheinungsbild/Logo/Link, Ergebnisse zurücksetzen |
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

## Was BTS schickt

- `tset` – alle Courts und die Spiele darauf, Turniername, turnier.de-Link, Turnierlogo
- `tupdate_match` – neuer Spielstand eines Spiels (bei jedem Punkt)

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
