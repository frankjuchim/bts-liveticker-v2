'use strict';

// Push-Benachrichtigungen (Web Push) für die Handy-Seite /app: Wer dort Spielern oder Vereinen
// folgt und Benachrichtigungen einschaltet, bekommt sie auch bei geschlossener Seite –
// „aufgerufen auf Court 3“, „gleich dran“, „beendet“.
//
// Schlüssel (VAPID) und Abos liegen im Datenverzeichnis: push-vapid.json, push-subs.json.
// Abos enthalten nur den Push-Endpunkt des Browsers und die gefolgten Namen, keine Personendaten.

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const MAX_SUBS = 5000;
const MAX_FOLLOW = 50;
// Nur die Push-Dienste der Browser (Google, Mozilla, Apple, Microsoft) – kein beliebiges Ziel
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.mozilla\.com$/, /\.mozaws\.net$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

function create(dataDir, contact) {
  const keyFile = path.join(dataDir, 'push-vapid.json');
  const subFile = path.join(dataDir, 'push-subs.json');
  let keys = null;
  try { keys = JSON.parse(fs.readFileSync(keyFile, 'utf8')); } catch (e) { /* neu erzeugen */ }
  if (!keys || !keys.publicKey || !keys.privateKey) {
    keys = webpush.generateVAPIDKeys();
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(keyFile, JSON.stringify(keys), { mode: 0o600 });
    } catch (e) { console.warn('Push-Schlüssel nicht gespeichert:', e.message); }
  }
  webpush.setVapidDetails(contact || 'https://github.com/frankjuchim/bts-liveticker-v2', keys.publicKey, keys.privateKey);

  let subs = [];
  try {
    const list = JSON.parse(fs.readFileSync(subFile, 'utf8'));
    if (Array.isArray(list)) subs = list.filter(valid);
  } catch (e) { /* keine Abos */ }
  let saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      fs.writeFile(subFile + '.tmp', JSON.stringify(subs), (err) => {
        if (!err) fs.rename(subFile + '.tmp', subFile, () => {});
      });
    }, 1000);
  }

  function valid(s) {
    if (!s || typeof s.endpoint !== 'string' || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') return false;
    let u;
    try { u = new URL(s.endpoint); } catch (e) { return false; }
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  }

  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 100)).slice(0, MAX_FOLLOW) : []);

  // Abo anlegen oder aktualisieren (gefolgte Spieler/Vereine)
  function subscribe(input) {
    const sub = input && input.subscription;
    if (!valid(sub)) throw new Error('Ungültiges Abo');
    const entry = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      players: list(input.players),
      clubs: list(input.clubs),
      at: new Date().toISOString(),
    };
    const i = subs.findIndex((s) => s.endpoint === entry.endpoint);
    if (i >= 0) subs[i] = entry;
    else {
      if (subs.length >= MAX_SUBS) subs.shift();
      subs.push(entry);
    }
    save();
    return entry;
  }

  function unsubscribe(endpoint) {
    const n = subs.length;
    subs = subs.filter((s) => s.endpoint !== endpoint);
    if (subs.length !== n) save();
  }

  const norm = (n) => String(n || '').trim().toLowerCase();
  function wants(s, ev) {
    const players = s.players.map(norm);
    const clubs = s.clubs.map(norm);
    return ev.players.some((p) => players.includes(norm(p))) || ev.clubs.some((c) => c && clubs.includes(norm(c)));
  }

  // Ereignis an alle passenden Abos schicken; abgelaufene Abos entfernen
  function notify(ev) {
    const targets = subs.filter((s) => wants(s, ev));
    if (!targets.length) return;
    const payload = JSON.stringify({ title: ev.title, body: ev.body, tag: ev.tag, url: ev.url || '/app' });
    for (const s of targets) {
      webpush.sendNotification(s, payload, { TTL: 900, urgency: 'high' }).catch((err) => {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) unsubscribe(s.endpoint);
        else console.warn('Push fehlgeschlagen:', err && (err.statusCode || err.message));
      });
    }
  }

  return { publicKey: () => keys.publicKey, subscribe, unsubscribe, notify, count: () => subs.length };
}

// Aus zwei Ständen (view) die Ereignisse für gefolgte Spieler ableiten
function events(prev, next) {
  const out = [];
  if (!prev) return out;
  const was = {};
  for (const m of prev.matches || []) was[m.id] = m.status;
  for (const u of prev.upcoming || []) if (!was[u.id]) was[u.id] = u.state;
  const names = (m) => (m.home || []).concat(m.away || []).filter(Boolean);
  const clubs = (m) => (m.homeClubs || []).concat(m.awayClubs || []).filter(Boolean);
  const vs = (m) => (m.home || []).filter(Boolean).join(' / ') + ' – ' + (m.away || []).filter(Boolean).join(' / ');
  for (const m of next.matches || []) {
    const before = was[m.id];
    if ((m.status === 'called' || m.status === 'live') && before !== 'called' && before !== 'live' && before !== 'finished') {
      out.push({ title: 'Court ' + (m.court || '?') + ': ' + m.name, body: vs(m), tag: m.id + ':court', players: names(m), clubs: clubs(m) });
    } else if (m.status === 'finished' && before && before !== 'finished' && m.source !== 'bts') {
      const w = m.winner === 'home' ? m.home : m.away;
      const sets = (m.sets || []).map((s) => (m.winner === 'away' ? s.away + ':' + s.home : s.home + ':' + s.away)).join(', ');
      out.push({
        title: 'Beendet: ' + m.name,
        body: (w || []).filter(Boolean).join(' / ') + ' gewinnt ' + Math.max(...m.setsWon) + ':' + Math.min(...m.setsWon) + (sets ? ' (' + sets + ')' : ''),
        tag: m.id + ':end', players: names(m), clubs: clubs(m),
      });
    }
  }
  for (const u of next.upcoming || []) {
    if (u.state === 'preparation' && was[u.id] !== 'preparation' && was[u.id] !== 'called' && was[u.id] !== 'live') {
      out.push({ title: 'Gleich dran: ' + u.name, body: vs(u) + (u.time ? ' · geplant ' + u.time + ' Uhr' : ''), tag: u.id + ':prep', players: names(u), clubs: clubs(u) });
    }
  }
  return out;
}

module.exports = { create, events };
