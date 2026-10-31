'use strict';

// BTS Liveticker – nimmt die Ticker-Daten der BTS-Turniersoftware per
// WebSocket entgegen (/ws/update, gleiches Protokoll wie der Ticker aus dem
// BTS-Repo) und verteilt sie per Server-Sent Events an Ticker- und Overlay-Seiten.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const store = require('./lib/store');
const branding = require('./lib/branding');
const authLib = require('./lib/auth');
const updaterLib = require('./lib/updater');

const PORT = parseInt(process.env.PORT || '80', 10);
const ENV_TICKER_PASSWORD = process.env.TICKER_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'bts-liveticker.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Erscheinungsbild: Konfiguration + Design + Einstellungen aus dem Admin-Panel
const DESIGNS = branding.loadDesigns(path.join(__dirname, 'designs'));
let settings = {};
try {
  settings = branding.cleanSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')), DESIGNS);
} catch (e) {
  if (e.code !== 'ENOENT') console.warn('Einstellungen verworfen:', e.message);
}
let BRAND = branding.load(process.env, DATA_DIR, settings, DESIGNS);
// ADMIN_PASSWORD gesetzt → festes Admin-Passwort (im Panel nicht änderbar)
const auth = authLib.create(DATA_DIR, process.env.ADMIN_PASSWORD);
const updater = updaterLib.create(__dirname, DATA_DIR);
let brandVersion = Date.now().toString(36);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PATCH_DIR = path.join(__dirname, 'bts-patch');
const MAX_MESSAGE = 8 * 1024 * 1024;   // tset enthält das Turnierlogo als Base64
const FLUSH_MS = 250;                  // Spielstände gebündelt verschicken

// Ticker-Passwort für BTS: im Admin-Panel geändert (ticker-password.json) oder TICKER_PASSWORD
const TICKER_PW_FILE = path.join(DATA_DIR, 'ticker-password.json');
let tickerPasswordSet = '';
try {
  const t = JSON.parse(fs.readFileSync(TICKER_PW_FILE, 'utf8'));
  if (t && typeof t.password === 'string') tickerPasswordSet = t.password;
} catch (e) { /* nicht im Admin-Panel geändert */ }
const tickerPassword = () => tickerPasswordSet || ENV_TICKER_PASSWORD;

// Testmodus (Admin-Panel): Zeitplan-Schätzung ohne Datum (für Simulationen vor dem
// Turniertag) und Diagnose der Aufschlagdaten
const TEST_FILE = path.join(DATA_DIR, 'testmode.json');
let testMode = false;
try { testMode = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8')).on === true; } catch (e) { /* aus */ }

if (!tickerPassword()) {
  console.warn('WARNUNG: Kein Ticker-Passwort gesetzt (TICKER_PASSWORD oder Admin-Panel) – BTS-Verbindungen werden abgelehnt.');
}

let data = store.emptyStore();
let stateJson = 'null';
const clients = new Set();

// Verbindungsstatus zu BTS (für Anzeige „verbunden / zuletzt aktualisiert“)
const bts = { connections: 0, connectedSince: null, lastMessageAt: null, lastFullAt: null };

function btsInfo() {
  return {
    connected: bts.connections > 0,
    connectedSince: bts.connectedSince,
    lastMessageAt: bts.lastMessageAt,
    lastFullAt: bts.lastFullAt,
  };
}

function rebuild() {
  const v = store.view(data, { bts: btsInfo(), testMode });
  // Link aus dem Admin-Panel geht vor den Link von BTS
  if (settings.hideLink) v.tournament.url = '';
  else if (settings.link) v.tournament.url = settings.link;
  stateJson = JSON.stringify(v);
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    data = store.restore(saved);
    store.view(data);   // wirft, falls der Stand trotzdem nicht passt
    console.log('Letzten Stand geladen:', STATE_FILE);
  } catch (e) {
    data = store.emptyStore();
    if (e.code !== 'ENOENT') console.warn('Gespeicherter Stand verworfen:', e.message);
  }
  rebuild();
}

let saveTimer = null;
function saveState() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdir(DATA_DIR, { recursive: true }, (err) => {
      if (err) return console.warn('DATA_DIR nicht anlegbar:', err.message);
      const tmp = STATE_FILE + '.tmp';
      fs.writeFile(tmp, JSON.stringify(data), (err2) => {
        if (err2) return console.warn('Speichern fehlgeschlagen:', err2.message);
        fs.rename(tmp, STATE_FILE, () => {});
      });
    });
  }, 2000);
}

// ---------------------------------------------------------------- SSE

function sendAll(event, json) {
  for (const res of clients) res.write(`event: ${event}\ndata: ${json}\n\n`);
}

// Änderungen sammeln und höchstens alle FLUSH_MS verschicken:
// kompletter Stand nach tset, sonst nur die geänderten Spiele.
let fullPending = false;
const dirty = new Set();
let flushTimer = null;

function schedule() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_MS);
}

function flush() {
  flushTimer = null;
  if (fullPending) {
    fullPending = false;
    dirty.clear();
    rebuild();
    sendAll('state', stateJson);
    return;
  }
  if (!dirty.size) return;
  const matches = [...dirty].map((id) => store.viewOne(data, id)).filter(Boolean);
  dirty.clear();
  rebuild();
  sendAll('matches', JSON.stringify({ matches, updatedAt: data.updatedAt, bts: btsInfo() }));
}

function changedFull() {
  fullPending = true;
  saveState();
  schedule();
}

// Herzschlag hält Reverse-Proxies (nginx o. ä.) die Verbindung offen
setInterval(() => {
  for (const res of clients) res.write(`: ping\n\n`);
}, 25000).unref();

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`retry: 3000\nevent: state\ndata: ${stateJson}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// ---------------------------------------------------------------- BTS-WebSocket

function passwordOk(given) {
  const pw = tickerPassword();
  if (!pw || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(pw).digest();
  return crypto.timingSafeEqual(a, b);
}

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

function handleBtsMessage(ws, msg) {
  const now = new Date().toISOString();
  bts.lastMessageAt = now;
  if (msg.type === 'tset') {
    store.applyTset(data, msg.event, now);
    bts.lastFullAt = now;
    changedFull();
    console.log(`tset: ${data.courts.length} Courts, ${Object.keys(data.matches).length} Spiele gespeichert`);
  } else if (msg.type === 'tupdate_match') {
    if (store.applyMatchUpdate(data, msg.match, now)) {
      dirty.add(String(msg.match._id));
      saveState();
      schedule();
    }
  } else {
    throw new Error('Unsupported message type ' + msg.type);
  }
}

wss.on('connection', (ws, req, authorized) => {
  const who = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const reply = (obj) => { try { ws.send(JSON.stringify(obj)); } catch (e) { /* Verbindung weg */ } };

  if (!authorized) {
    console.warn('BTS-Verbindung mit falschem Passwort von', who);
    // Wie der BTS-Ticker: Fehler melden, Verbindung aber nicht schließen –
    // sonst versucht BTS sekündlich neu zu verbinden.
    reply({ type: 'error', message: 'Incorrect password' });
    ws.on('message', () => {});
    setTimeout(() => ws.close(1008, 'password'), 10 * 60 * 1000).unref();
    return;
  }

  bts.connections++;
  if (bts.connections === 1) bts.connectedSince = new Date().toISOString();
  console.log('BTS verbunden von', who);
  changedFull();

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString('utf8'));
      if (!msg || !msg.type) throw new Error('type fehlt');
    } catch (e) {
      return reply({ type: 'error', message: 'invalid JSON or type missing' });
    }
    if (msg.type === 'error') return console.warn('Fehlermeldung von BTS:', msg.message);
    try {
      handleBtsMessage(ws, msg);
      reply({ type: 'answer', status: 'ok', rid: msg.rid });
    } catch (e) {
      console.warn(`Fehler bei ${msg.type}:`, e.message);
      reply({ type: 'error', message: e.message, rid: msg.rid });
    }
  });

  ws.on('close', () => {
    bts.connections = Math.max(0, bts.connections - 1);
    if (!bts.connections) bts.connectedSince = null;
    console.log('BTS-Verbindung getrennt');
    changedFull();
  });
  ws.on('error', () => {});
});

// Ping alle 25 s: hält die Verbindung durch nginx offen und erkennt tote Verbindungen
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    if (ws.isAlive) ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignorieren */ }
  }
}, 25000).unref();

// ---------------------------------------------------------------- HTTP

function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }, extra || {}));
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// Hübsche URLs → HTML-Dateien
const ROUTES = {
  '/': 'index.html',
  '/courts': 'courts.html',
};

function serveStatic(req, res, pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  // Admin-Panel nur nach Anmeldung, sonst die Login-Seite
  if (clean === '/admin' || clean === '/admin.html') {
    return serveFile(res, auth.loggedIn(req) ? 'admin.html' : 'login.html', {
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    });
  }
  let file = ROUTES[clean];
  if (!file && /^\/court\/[^/]+$/.test(clean)) file = 'court.html';
  if (!file && /^\/feld\/[^/]+$/.test(clean)) file = 'field.html';
  if (clean === '/ergebnis') file = 'result.html';
  if (clean === '/spieler') file = 'players.html';
  if (clean === '/baum') file = 'draws.html';
  if (clean === '/felder') file = 'fields.html';
  if (!file) file = clean.replace(/^\/+/, '');
  serveFile(res, file);
}

function serveFile(res, file, headers) {
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const ext = path.extname(full);
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }, headers || {}));
    // Titel/Logo aus der Konfiguration einsetzen
    res.end(ext === '.html' ? branding.render(buf.toString('utf8'), BRAND) : buf);
  });
}

// Eigenes Logo aus der Konfiguration (LOGO_FILE bzw. <DATA_DIR>/logo.*)
function serveBrandLogo(req, res) {
  if (!BRAND.logoFile) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(BRAND.logoFile, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(BRAND.logoFile).toLowerCase()] || 'application/octet-stream', {
      'Cache-Control': 'no-cache',
      // hochgeladene SVGs dürfen keine Skripte ausführen, auch nicht bei direktem Aufruf
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
  });
}

// Logo eines Designs (Vorschau im Admin-Panel)
function serveDesignLogo(req, res, id) {
  const d = DESIGNS[id];
  if (!d || !d.logoFile) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(d.logoFile, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(d.logoFile).toLowerCase()] || 'application/octet-stream', {
      'Cache-Control': 'public, max-age=3600',
    });
  });
}

// Turnierlogo, das BTS mitschickt
function serveLogo(req, res) {
  const t = data.tournament;
  if (!t.logo) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, Buffer.from(t.logo, 'base64'), t.logoMime || 'image/png', {
    'Cache-Control': 'public, max-age=86400',
  });
}

// BTS-Erweiterung zum Herunterladen auf dem BTS-Server (enthält keine Geheimnisse)
function servePatch(req, res, name) {
  if (!/^[\w-]+\.patch$/.test(name)) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(path.join(PATCH_DIR, name), (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, 'text/plain; charset=utf-8');
  });
}

// Liest den Request-Body; bei mehr als max Bytes wird null übergeben
function readBody(req, cb, max) {
  max = max || 64 * 1024;
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size <= max) chunks.push(c);
  });
  req.on('end', () => cb(size > max ? null : Buffer.concat(chunks).toString('utf8')));
}

function brandInfo() {
  // Werte ohne eigene Anpassungen (für das gewählte Design) – Platzhalter im Admin-Panel
  const defaults = branding.load(process.env, DATA_DIR, { design: settings.design }, DESIGNS);
  return {
    design: BRAND.design,
    designs: Object.values(DESIGNS).map((d) => {
      const b = branding.load(process.env, DATA_DIR, { design: d.id }, DESIGNS);
      return {
        id: d.id, name: d.name, title: b.title, subtitle: b.subtitle, accent: b.accent,
        logoUrl: d.logoFile ? '/design-logo/' + d.id : null,
      };
    }),
    title: BRAND.title,
    subtitle: BRAND.subtitle,
    accent: BRAND.accent,
    logoUrl: BRAND.logoUrl,
    logoUploaded: BRAND.logoUploaded,
    version: brandVersion,
    custom: settings,
    btsLink: data.tournament.url || '',
    defaults: { title: defaults.title, subtitle: defaults.subtitle, accent: defaults.accent },
    presets: branding.PRESETS,
  };
}

// Erscheinungsbild neu laden und offenen Seiten mitteilen
function brandChanged() {
  BRAND = branding.load(process.env, DATA_DIR, settings, DESIGNS);
  brandVersion = Date.now().toString(36);
  const info = JSON.stringify(brandInfo());
  sendAll('brand', info);
  // Link steckt im Stand – neu verschicken
  rebuild();
  sendAll('state', stateJson);
  return info;
}

// Admin-Aktionen nur mit Anmeldung; sonst 401 (die Seite zeigt dann den Login)
function requireAdmin(req, res) {
  if (auth.loggedIn(req)) return true;
  send(res, 401, '{"error":"Nicht angemeldet – bitte neu anmelden","login":true}');
  return false;
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function handleLogin(req, res) {
  readBody(req, (body) => {
    let input = {};
    try { input = JSON.parse(body) || {}; } catch (e) { /* leer */ }
    const r = auth.login(input.password, clientIp(req));
    if (!r.token) {
      if (r.status === 401) console.warn('Admin-Login fehlgeschlagen von', clientIp(req));
      return send(res, r.status, JSON.stringify({ error: r.error }));
    }
    send(res, 200, JSON.stringify({ ok: true, defaultPassword: auth.isDefault() }), null, {
      'Set-Cookie': auth.cookie(req, r.token),
    });
  });
}

function handleLogout(req, res) {
  auth.logout(req);
  send(res, 200, '{"ok":true}', null, { 'Set-Cookie': auth.cookie(req, null) });
}

// Admin-Passwort ändern ({ current, next })
function handleAdminPassword(req, res) {
  if (!requireAdmin(req, res)) return;
  readBody(req, (body) => {
    let input = {};
    try { input = JSON.parse(body) || {}; } catch (e) { /* leer */ }
    let r;
    try {
      r = auth.change(input.current, input.next, req);
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'Speichern fehlgeschlagen: ' + e.message }));
    }
    if (!r.ok) return send(res, r.status, JSON.stringify({ error: r.error }));
    console.log('Admin-Passwort geändert');
    send(res, 200, '{"ok":true}');
  });
}

// Logo hochladen ({ data: Base64 }) oder entfernen ({ remove: true })
function handleLogo(req, res) {
  if (!requireAdmin(req, res)) return;
  readBody(req, (body) => {
    if (body == null) return send(res, 413, '{"error":"Logo ist zu groß (max. 10 MB)"}');
    let input = {};
    try { input = JSON.parse(body) || {}; } catch (e) { /* leer */ }
    try {
      if (input.remove) {
        branding.removeLogo(DATA_DIR);
        console.log('Logo entfernt');
      } else {
        const b64 = String(input.data || '').replace(/^data:[^,]*,/, '');
        const ext = branding.saveLogo(DATA_DIR, Buffer.from(b64, 'base64'));
        console.log('Logo hochgeladen:', ext);
      }
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e.message }));
    }
    send(res, 200, brandChanged());
  }, Math.ceil(branding.MAX_LOGO * 1.4) + 4096);
}

// Titel/Untertitel/Farbe aus dem Admin-Panel speichern ({ reset: true } = Standard)
function handleBrand(req, res) {
  if (!requireAdmin(req, res)) return;
  readBody(req, (body) => {
    let input = {};
    try { input = JSON.parse(body) || {}; } catch (e) { /* leer */ }
    let next;
    try {
      next = input.reset ? {} : branding.cleanSettings(input, DESIGNS);
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e.message }));
    }
    fs.mkdir(DATA_DIR, { recursive: true }, () => {
      fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), (err) => {
        if (err) return send(res, 500, JSON.stringify({ error: 'Speichern fehlgeschlagen: ' + err.message }));
        settings = next;
        console.log('Erscheinungsbild geändert:', JSON.stringify(settings));
        send(res, 200, brandChanged());
      });
    });
  });
}

// Ergebnisliste leeren (z. B. vor einem neuen Turniertag)
function handleReset(req, res) {
  if (!requireAdmin(req, res)) return;
  readBody(req, () => {
    const onCourt = new Set(data.courts.map((c) => c.match).filter(Boolean));
    for (const id of Object.keys(data.matches)) if (!onCourt.has(id)) delete data.matches[id];
    data.updatedAt = new Date().toISOString();
    changedFull();
    console.log('Ergebnisliste zurückgesetzt');
    send(res, 200, '{"ok":true}');
  });
}

// Update aus dem Admin-Panel: Stand abfragen (GET, ?check=1 fragt GitHub) bzw. starten (POST)
function handleUpdateInfo(req, res, check) {
  if (!requireAdmin(req, res)) return;
  const info = { mode: updater.mode(), installed: updater.installed(), running: updater.running(), log: updater.log() };
  const done = (latest, error) => send(res, 200, JSON.stringify(Object.assign(info, { latest, error })), null, {
    'Cache-Control': 'no-store',
  });
  // Docker (z. B. CapRover) oder unbekannte Installation: Update nicht von hier – GitHub nicht fragen
  if (!check || info.mode === 'none' || (info.mode === 'docker' && !info.installed)) return done(null, null);
  updater.latest(check === 'force').then((l) => done(l, null), (e) => done(null, String(e.message || e)));
}

function handleUpdateStart(req, res) {
  if (!requireAdmin(req, res)) return;
  readBody(req, () => {
    try {
      updater.start();
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e.message }));
    }
    console.log('Update aus dem Admin-Panel angefordert');
    send(res, 200, '{"ok":true}');
  });
}

// Ticker-Passwort für BTS ändern ({ password }); leer = zurück zu TICKER_PASSWORD aus der Konfiguration.
// Nur Zeichen, die BTS ohne Umkodierung in die Adresse (?password=…) schreiben kann.
// Eine bestehende BTS-Verbindung bleibt bestehen, das neue Passwort gilt ab der nächsten.
function handleTickerPassword(req, res) {
  if (!requireAdmin(req, res)) return;
  readBody(req, (body) => {
    let input = {};
    try { input = JSON.parse(body) || {}; } catch (e) { /* leer */ }
    const pw = typeof input.password === 'string' ? input.password.trim() : '';
    if (pw && !/^[A-Za-z0-9._~-]{6,100}$/.test(pw)) {
      return send(res, 400, JSON.stringify({
        error: 'Bitte 6 bis 100 Zeichen, nur Buchstaben (ohne Umlaute), Ziffern und - _ . ~',
      }));
    }
    if (!pw && !ENV_TICKER_PASSWORD) {
      return send(res, 400, JSON.stringify({ error: 'Ohne TICKER_PASSWORD in der Konfiguration muss hier ein Passwort gesetzt sein.' }));
    }
    try {
      if (pw) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = TICKER_PW_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ password: pw, changedAt: new Date().toISOString() }), { mode: 0o600 });
        fs.renameSync(tmp, TICKER_PW_FILE);
      } else {
        fs.rmSync(TICKER_PW_FILE, { force: true });
      }
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'Speichern fehlgeschlagen: ' + e.message }));
    }
    tickerPasswordSet = pw;
    console.log(pw ? 'Ticker-Passwort im Admin-Panel geändert' : 'Ticker-Passwort auf TICKER_PASSWORD zurückgesetzt');
    send(res, 200, JSON.stringify({ ok: true, tickerPassword: tickerPassword(), tickerPasswordSource: pw ? 'admin' : 'env' }));
  });
}

// BTS-Verbindung neu aufbauen: alle Verbindungen schließen – BTS verbindet sich nach
// etwa einer Sekunde von selbst neu und schickt dabei den kompletten Stand (tset).
// Hilft auch nach einer Passwortänderung (falsches Passwort hält BTS sonst 10 min fest).
function handleBtsReconnect(req, res) {
  if (!requireAdmin(req, res)) return;
  readBody(req, () => {
    let n = 0;
    for (const ws of wss.clients) {
      n++;
      try { ws.close(1012, 'reconnect'); } catch (e) { ws.terminate(); }
    }
    console.log('BTS-Verbindungen aus dem Admin-Panel getrennt:', n);
    send(res, 200, JSON.stringify({ ok: true, closed: n }));
  });
}

function handleTestMode(req, res) {
  if (!requireAdmin(req, res)) return;
  readBody(req, (body) => {
    let input = {};
    try { input = JSON.parse(body) || {}; } catch (e) { /* leer */ }
    try {
      if (input.on === true) fs.writeFileSync(TEST_FILE, JSON.stringify({ on: true, since: new Date().toISOString() }));
      else fs.rmSync(TEST_FILE, { force: true });
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'Speichern fehlgeschlagen: ' + e.message }));
    }
    testMode = input.on === true;
    console.log('Testmodus', testMode ? 'an' : 'aus');
    changedFull();
    send(res, 200, JSON.stringify({ ok: true, on: testMode }));
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (req.method === 'POST' && pathname === '/api/reset') return handleReset(req, res);
  if (req.method === 'POST' && pathname === '/api/update') return handleUpdateStart(req, res);
  if (req.method === 'POST' && pathname === '/api/brand') return handleBrand(req, res);
  if (req.method === 'POST' && pathname === '/api/logo') return handleLogo(req, res);
  if (req.method === 'POST' && pathname === '/api/login') return handleLogin(req, res);
  if (req.method === 'POST' && pathname === '/api/logout') return handleLogout(req, res);
  if (req.method === 'POST' && pathname === '/api/admin-password') return handleAdminPassword(req, res);
  if (req.method === 'POST' && pathname === '/api/ticker-password') return handleTickerPassword(req, res);
  if (req.method === 'POST' && pathname === '/api/testmode') return handleTestMode(req, res);
  if (req.method === 'POST' && pathname === '/api/bts-reconnect') return handleBtsReconnect(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '{"error":"method"}');
  if (pathname === '/api/state') return send(res, 200, stateJson);
  if (pathname === '/api/draws') return send(res, 200, JSON.stringify(store.drawsView(data)));
  if (pathname === '/api/brand') return send(res, 200, JSON.stringify(brandInfo()));
  if (pathname === '/api/admin') {
    if (!requireAdmin(req, res)) return;
    return send(res, 200, JSON.stringify({
      defaultPassword: auth.isDefault(), passwordFromEnv: auth.fromEnv(), tickerPassword: tickerPassword(),
      tickerPasswordSource: tickerPasswordSet ? 'admin' : (ENV_TICKER_PASSWORD ? 'env' : 'none'),
    }), null, {
      'Cache-Control': 'no-store',
    });
  }
  if (pathname === '/api/update') return handleUpdateInfo(req, res, new URL(req.url, 'http://x').searchParams.get('check'));
  if (pathname === '/api/events') return handleEvents(req, res);
  if (pathname === '/tournament-logo') return serveLogo(req, res);
  if (pathname === '/config.css') return send(res, 200, BRAND.css, 'text/css; charset=utf-8', { 'Cache-Control': 'no-cache' });
  if (pathname.startsWith('/brand-logo')) return serveBrandLogo(req, res);
  if (pathname.startsWith('/design-logo/')) return serveDesignLogo(req, res, pathname.slice(13));
  if (pathname.startsWith('/bts-patch/')) return servePatch(req, res, pathname.slice(11));
  if (pathname === '/healthz') return send(res, 200, '{"ok":true}');
  serveStatic(req, res, pathname);
});

// BTS verlangt eine Adresse, die „/update“ enthält: wss://<domain>/ws/update
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (!/\/update\/?$/.test(url.pathname)) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  const authorized = passwordOk(url.searchParams.get('password'));
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, authorized));
});

loadState();
server.listen(PORT, () => console.log(`BTS Liveticker läuft auf Port ${PORT}`));

// Beenden (systemd, Docker): Stand sofort speichern und ohne Wartezeit beenden.
// Im Container läuft Node als Prozess 1 und beachtet SIGTERM sonst nicht.
function shutdown(signal) {
  console.log('Beende (' + signal + ')');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(data));
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
  } catch (e) {
    console.warn('Speichern beim Beenden fehlgeschlagen:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
