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

const PORT = parseInt(process.env.PORT || '80', 10);
const TICKER_PASSWORD = process.env.TICKER_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'bts-liveticker.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Erscheinungsbild: Konfiguration + Einstellungen aus dem Admin-Panel
let settings = {};
try {
  settings = branding.cleanSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
} catch (e) {
  if (e.code !== 'ENOENT') console.warn('Einstellungen verworfen:', e.message);
}
let BRAND = branding.load(process.env, DATA_DIR, settings);
let brandVersion = Date.now().toString(36);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PATCH_DIR = path.join(__dirname, 'bts-patch');
const MAX_MESSAGE = 8 * 1024 * 1024;   // tset enthält das Turnierlogo als Base64
const FLUSH_MS = 250;                  // Spielstände gebündelt verschicken

if (!TICKER_PASSWORD) {
  console.warn('WARNUNG: TICKER_PASSWORD ist nicht gesetzt – BTS-Verbindungen werden abgelehnt.');
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
  const v = store.view(data, { bts: btsInfo() });
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
  if (!TICKER_PASSWORD || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(TICKER_PASSWORD).digest();
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
  '/admin': 'admin.html',
};

function serveStatic(req, res, pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  let file = ROUTES[clean];
  if (!file && /^\/court\/[^/]+$/.test(clean)) file = 'court.html';
  if (!file) file = clean.replace(/^\/+/, '');
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const ext = path.extname(full);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
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
  const defaults = branding.load(process.env, DATA_DIR);
  return {
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
  BRAND = branding.load(process.env, DATA_DIR, settings);
  brandVersion = Date.now().toString(36);
  const info = JSON.stringify(brandInfo());
  sendAll('brand', info);
  // Link steckt im Stand – neu verschicken
  rebuild();
  sendAll('state', stateJson);
  return info;
}

// Logo hochladen ({ password, data: Base64 }) oder entfernen ({ password, remove: true })
function handleLogo(req, res) {
  readBody(req, (body) => {
    if (body == null) return send(res, 413, '{"error":"Logo ist zu groß (max. 2 MB)"}');
    let input = {};
    try { input = JSON.parse(body) || {}; } catch (e) { /* leer */ }
    if (!passwordOk(input.password)) return send(res, 401, '{"error":"Falsches Passwort"}');
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
  readBody(req, (body) => {
    let input = {};
    try { input = JSON.parse(body) || {}; } catch (e) { /* leer */ }
    if (!passwordOk(input.password)) return send(res, 401, '{"error":"Falsches Passwort"}');
    let next;
    try {
      next = input.reset ? {} : branding.cleanSettings(input);
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
  readBody(req, (body) => {
    let given = '';
    try { given = JSON.parse(body).password; } catch (e) { /* leer */ }
    if (!passwordOk(given)) return send(res, 401, '{"error":"Falsches Passwort"}');
    const onCourt = new Set(data.courts.map((c) => c.match).filter(Boolean));
    for (const id of Object.keys(data.matches)) if (!onCourt.has(id)) delete data.matches[id];
    data.updatedAt = new Date().toISOString();
    changedFull();
    console.log('Ergebnisliste zurückgesetzt');
    send(res, 200, '{"ok":true}');
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (req.method === 'POST' && pathname === '/api/reset') return handleReset(req, res);
  if (req.method === 'POST' && pathname === '/api/brand') return handleBrand(req, res);
  if (req.method === 'POST' && pathname === '/api/logo') return handleLogo(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '{"error":"method"}');
  if (pathname === '/api/state') return send(res, 200, stateJson);
  if (pathname === '/api/brand') return send(res, 200, JSON.stringify(brandInfo()));
  if (pathname === '/api/events') return handleEvents(req, res);
  if (pathname === '/tournament-logo') return serveLogo(req, res);
  if (pathname === '/config.css') return send(res, 200, BRAND.css, 'text/css; charset=utf-8', { 'Cache-Control': 'no-cache' });
  if (pathname.startsWith('/brand-logo')) return serveBrandLogo(req, res);
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
