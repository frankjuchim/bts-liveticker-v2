'use strict';

// Simuliert BTS: verbindet sich wie bts/ticker_conn.js mit dem Liveticker und
// spielt auf mehreren Courts Spiele durch.
//   node tools/fake-bts.js ws://localhost:8080/ws/update test [courts] [ms pro Punkt]
// Standard: BTS mit Erweiterung v2 (Aufschlag, Vereine, Spieldauer, nächste Spiele).
// EXT=1 nur erste Version (Aufschlag), NO_EXT=1 BTS ohne Erweiterung.

const WebSocket = require('ws');

const url = process.argv[2] || 'ws://localhost:8080/ws/update';
const password = process.argv[3] || 'test';
const COURTS = parseInt(process.argv[4] || '4', 10);
const SPEED = parseInt(process.argv[5] || '400', 10);

const SF = {
  numSets: 3,
  set_points: { end_points: 21, max_points: 30 },
  last_set_points: { end_points: 21, max_points: 30 },
};
const FIRST = ['Max', 'Lena', 'Jonas', 'Mia', 'Paul', 'Emma', 'Finn', 'Lea', 'Ben', 'Hanna', 'Tom', 'Clara'];
const LAST = ['Meyer', 'Schulz', 'Wagner', 'Becker', 'Hoffmann', 'Koch', 'Richter', 'Wolf', 'Neumann', 'Krüger'];
const EVENTS = ['HE U15', 'DE U17', 'HD U19', 'DD U15', 'GD U17', 'HE O19'];
const ROUNDS = ['R16', 'VF', 'HF', 'Finale', 'undefined'];

const CLUBS = ['TV Metjendorf', 'BC Oldenburg', 'SG Ammerland', 'TuS Wildeshausen', 'VfL Westerstede', 'BV Bremen'];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
// Fester Spielerstamm, damit dieselben Spieler mehrfach spielen (zum Folgen)
const PEOPLE = [];
while (PEOPLE.length < 40) {
  const name = pick(FIRST) + ' ' + pick(LAST);
  if (!PEOPLE.some((p) => p.name === name)) PEOPLE.push({ name, club: pick(CLUBS) });
}
const person = () => pick(PEOPLE);

let nextId = 1;
const courts = [];
for (let i = 1; i <= COURTS; i++) courts.push({ _id: 'court_' + i, num: i, match_id: null });
const matches = new Map();

function newMatch() {
  const ev = pick(EVENTS);
  const doubles = /^(HD|DD|GD)/.test(ev);
  const team = () => (doubles ? [person(), person()] : [person()]);
  const t0 = team();
  const t1 = team();
  const m = {
    _id: 'match_' + nextId++, n: ev + ' ' + pick(ROUNDS), p0: t0.map((p) => p.name), p1: t1.map((p) => p.name), s: [], sf: SF,
    d: doubles, ts: Math.random() < 0.5, pe: [true, true],   // wie BTS mit Erweiterung aus bts-patch/
    c0: t0.map((p) => p.club), c1: t1.map((p) => p.club),
  };
  matches.set(m._id, m);
  return m;
}

// Warteschlange der nächsten Spiele (wie liveticker_upcoming in BTS)
const queue = [];
let clock = Date.now() - 40 * 60000;   // Turnier liegt etwas hinter dem Plan
function refill() {
  while (queue.length < 10) {
    clock += 12 * 60000;
    const m = newMatch();
    const d = new Date(clock);
    m.t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    m.dt = d.toISOString().slice(0, 10);
    m.mn = nextId;
    queue.push(m);
  }
  queue.forEach((m, i) => { m.st = i < 2 ? 'preparation' : 'scheduled'; });
}
function nextMatch() {
  refill();
  const m = queue.shift();
  refill();
  return m;
}

function setDone(h, a) {
  return (h >= 21 && h - a >= 2) || h === 30 || (a >= 21 && a - h >= 2) || a === 30;
}

function finished(m) {
  const won = [0, 0];
  for (const [h, a] of m.s) if (setDone(h, a)) won[h > a ? 0 : 1]++;
  return won[0] === 2 || won[1] === 2;
}

const ws = new WebSocket(url + '?password=' + encodeURIComponent(password));
const send = (msg) => ws.send(JSON.stringify(msg));
const NO_EXT = process.env.NO_EXT === '1';
const V1 = process.env.EXT === '1';
const base = (m) => ({ _id: m._id, n: m.n, p0: m.p0, p1: m.p1, s: m.s, sf: m.sf });
// Spieldauer: Echtzeit × 20, damit sie nach einem Turnierspiel aussieht
const dur = (m) => (m.started ? (Date.now() - m.started) * 20 : null);
function plain(m) {
  if (NO_EXT) return base(m);
  const v1 = Object.assign(base(m), { d: m.d, ts: m.ts, pe: m.pe });
  return V1 ? v1 : Object.assign(v1, { c0: m.c0, c1: m.c1, dur: dur(m) });
}
const pushall = () => {
  const event = {
    courts,
    matches: courts.filter((c) => c.match_id).map((c) => plain(matches.get(c.match_id))),
    tournament_name: 'Muster Open (Test)',
    tournament_url: 'https://www.turnier.de/tournaments/',
  };
  if (!NO_EXT && !V1) {
    refill();
    event.upcoming = queue.map((m) => ({ _id: m._id, n: m.n, p0: m.p0, p1: m.p1, c0: m.c0, c1: m.c1, t: m.t, dt: m.dt, st: m.st, mn: m.mn }));
  }
  send({ type: 'tset', event });
};

ws.on('open', () => {
  console.log('verbunden');
  courts.forEach((c, i) => { if (i < COURTS - 1) c.match_id = nextMatch()._id; });
  pushall();
  setInterval(tick, SPEED);
});
ws.on('message', (d) => {
  const msg = JSON.parse(d);
  if (msg.type === 'error') console.log('Fehler vom Ticker:', msg.message);
});
ws.on('close', () => { console.log('getrennt'); process.exit(1); });

function tick() {
  const c = pick(courts);
  if (!c.match_id) {
    if (Math.random() < 0.2) { c.match_id = nextMatch()._id; pushall(); }
    return;
  }
  const m = matches.get(c.match_id);
  if (finished(m)) {
    // Court wieder freigeben (BTS: nach Bestätigung des Ergebnisses)
    if (Math.random() < 0.3) { c.match_id = null; pushall(); }
    return;
  }
  if (!m.started) m.started = Date.now();
  if (!m.s.length || setDone(...m.s[m.s.length - 1])) m.s.push([0, 0]);
  const g = m.s[m.s.length - 1];
  const won = Math.random() < 0.5 ? 0 : 1;
  const srv = m.ts ? 0 : 1;
  g[won]++;
  // Badmintonregeln: gewinnt das aufschlagende Team, wechselt der Aufschläger
  // das Feld; sonst geht der Aufschlag ohne Positionswechsel zum Gegner.
  if (won === srv) m.pe[srv] = !m.pe[srv];
  else m.ts = won === 0;
  const upd = { _id: m._id, s: m.s };
  if (!NO_EXT) Object.assign(upd, { ts: m.ts, pe: m.pe });
  if (!NO_EXT && !V1) upd.dur = dur(m);
  send({ type: 'tupdate_match', match: upd });
}
