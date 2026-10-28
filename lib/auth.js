'use strict';

// Anmeldung für das Admin-Panel.
// Das Passwort liegt nur als scrypt-Hash in <DATA_DIR>/admin.json. Fehlt die Datei
// (neue Installation oder nach einem Update), gilt das Standardpasswort.
// Wird envPassword übergeben (Umgebungsvariable ADMIN_PASSWORD), gilt nur dieses –
// es lässt sich dann im Admin-Panel nicht ändern.
// Angemeldet bleibt man über ein Cookie mit zufälligem Token (nur im Speicher –
// nach einem Neustart des Dienstes muss man sich neu anmelden).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PASSWORD = 'btsliveadmin';
const COOKIE = 'btsadmin';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;   // 7 Tage, verlängert sich bei Benutzung
const MIN_LENGTH = 8;
const MAX_FAILS = 10;                          // Fehlversuche pro IP …
const FAIL_WINDOW_MS = 15 * 60 * 1000;         // … innerhalb von 15 Minuten

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function create(dataDir, envPassword) {
  const file = path.join(dataDir, 'admin.json');
  let stored = null;     // { salt, hash } oder null = Standardpasswort
  const sessions = new Map();   // token → Ablaufzeit
  const fails = new Map();      // ip → [Zeitpunkte]

  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && s.salt && s.hash) stored = { salt: s.salt, hash: s.hash };
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('admin.json unlesbar – Standardpasswort gilt:', e.message);
  }

  function check(password) {
    if (typeof password !== 'string' || !password) return false;
    if (envPassword) return safeEqual(password, envPassword);
    if (!stored) return safeEqual(password, DEFAULT_PASSWORD);
    return safeEqual(hash(password, stored.salt), stored.hash);
  }

  function blocked(ip) {
    const now = Date.now();
    const list = (fails.get(ip) || []).filter((t) => now - t < FAIL_WINDOW_MS);
    fails.set(ip, list);
    return list.length >= MAX_FAILS;
  }

  // Liefert { token } bei Erfolg, sonst { error, status }
  function login(password, ip) {
    if (blocked(ip)) return { status: 429, error: 'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen.' };
    if (!check(password)) {
      fails.get(ip).push(Date.now());
      return { status: 401, error: 'Falsches Passwort' };
    }
    fails.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    return { token };
  }

  function tokenFrom(req) {
    const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([0-9a-f]{64})').exec(req.headers.cookie || '');
    return m ? m[1] : null;
  }

  function loggedIn(req) {
    const token = tokenFrom(req);
    if (!token) return false;
    const until = sessions.get(token);
    if (!until || until < Date.now()) {
      sessions.delete(token);
      return false;
    }
    sessions.set(token, Date.now() + SESSION_MS);
    return true;
  }

  function logout(req) {
    const token = tokenFrom(req);
    if (token) sessions.delete(token);
  }

  // Passwort ändern; andere Anmeldungen werden beendet, die aktuelle bleibt
  function change(current, next, req) {
    if (envPassword) return { status: 409, error: 'Das Passwort ist über die Variable ADMIN_PASSWORD festgelegt und wird dort geändert.' };
    if (!check(current)) return { status: 401, error: 'Aktuelles Passwort ist falsch' };
    if (typeof next !== 'string' || next.length < MIN_LENGTH) {
      return { status: 400, error: `Neues Passwort braucht mindestens ${MIN_LENGTH} Zeichen` };
    }
    if (next.length > 200) return { status: 400, error: 'Neues Passwort ist zu lang' };
    if (next === DEFAULT_PASSWORD) return { status: 400, error: 'Bitte ein anderes als das Standardpasswort wählen' };
    const salt = crypto.randomBytes(16).toString('hex');
    const entry = { salt, hash: hash(next, salt), changedAt: new Date().toISOString() };
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entry, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    stored = { salt: entry.salt, hash: entry.hash };
    const keep = tokenFrom(req);
    for (const t of sessions.keys()) if (t !== keep) sessions.delete(t);
    return { ok: true };
  }

  // Cookie: nur für diese Seite, nicht per JavaScript lesbar, nicht von fremden Seiten mitgeschickt
  function cookie(req, token) {
    const https = req.socket.encrypted || /^https/i.test(String(req.headers['x-forwarded-proto'] || ''));
    const parts = [
      `${COOKIE}=${token || ''}`, 'Path=/', 'HttpOnly', 'SameSite=Strict',
      token ? `Max-Age=${Math.floor(SESSION_MS / 1000)}` : 'Max-Age=0',
    ];
    if (https) parts.push('Secure');
    return parts.join('; ');
  }

  return {
    login, loggedIn, logout, change, cookie,
    isDefault: () => !envPassword && !stored,
    fromEnv: () => Boolean(envPassword),
  };
}

module.exports = { create, DEFAULT_PASSWORD, MIN_LENGTH };
