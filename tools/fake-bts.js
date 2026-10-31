'use strict';

// Simuliert BTS: verbindet sich wie bts/ticker_conn.js mit dem Liveticker und
// spielt auf mehreren Courts Spiele durch.
//   node tools/fake-bts.js ws://localhost:8080/ws/update test [courts] [ms pro Punkt]
// Standard: BTS mit Erweiterung v3 (Aufschlag, Vereine, Spieldauer, nächste Spiele,
// Turnierbäume). EXT=2 Version 2, EXT=1 erste Version (Aufschlag), NO_EXT=1 ohne Erweiterung.

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
    di: ev === 'HE O19' ? '1' : (ev === 'DE U17' ? '2' : null),   // Feld (für die Turnierbäume)
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

// ---- Turnierbäume (Erweiterung v3): ein KO-Feld mit Freilosen und Spiel um Platz 3,
// eines ohne Freilose und eine Gruppe; im Lauf der Simulation werden Spiele beendet.
const DRAWS = [];
let drawMatchNr = 100;
function koDraw(di, name, entries) {
  // Feldgröße: nächste Zweierpotenz; Freilose für die ersten Setzplätze
  let size = 1;
  while (size < entries.length) size *= 2;
  const rounds = Math.log2(size);
  const roundNames = { 1: 'Finale', 2: 'HF', 3: 'VF', 4: 'R16', 5: 'R32' };
  const slots = [];
  for (let i = 0; i < size; i++) slots.push(i < entries.length ? entries[i] : null);
  // Paarungen 1 gegen size usw. – Freilose treffen die besten Plätze
  const order = [];
  for (let i = 0; i < size / 2; i++) order.push([slots[i], slots[size - 1 - i]]);
  let planning = 1000 * Number(di);
  let prev = order.map((pair) => ({ entry: null, pair }));
  const all = [];
  for (let r = rounds; r >= 1; r--) {
    const next = [];
    for (let i = 0; i < prev.length; i += 2 * (r === rounds ? 0.5 : 1)) {
      if (r === rounds) {
        const [a, b] = prev[i].pair;
        const pl = ++planning;
        if (a && b) {
          const m = node(di, name, roundNames[r], pl, a, b);
          all.push(m);
          next.push({ match: m, pl });
        } else next.push({ entry: a || b, pl });   // Freilos: kein Spiel
      } else {
        const x = prev[i], y = prev[i + 1];
        const pl = ++planning;
        const m = node(di, name, roundNames[r], pl, x.entry, y.entry);
        m.f1 = x.pl; m.f2 = y.pl;
        if (x.match) x.match.wt = pl;
        if (y.match) y.match.wt = pl;
        all.push(m);
        next.push({ match: m, pl });
      }
    }
    prev = next;
  }
  // Spiel um Platz 3 aus den Verlierern der Halbfinals
  const hf = all.filter((m) => m.r === 'HF');
  if (hf.length === 2) {
    const pl = ++planning;
    const m = node(di, name, '3/4', pl, null, null);
    m.f1 = hf[0].pl; m.f2 = hf[1].pl;
    hf.forEach((h) => { h.lt = pl; });
    all.push(m);
  }
  DRAWS.push(...all);
}
function node(di, name, round, pl, a, b) {
  return {
    _id: 'draw_' + di + '_' + pl, di: String(di), dn: name, en: name, sn: 'Hauptfeld', r: round, ph: round,
    mn: ++drawMatchNr, pl, f1: null, f2: null, wt: null, lt: null,
    p0: a ? a.p : [], p1: b ? b.p : [], c0: a ? a.c : [], c1: b ? b.c : [],
    s: null, w: null, st: a && b ? 'scheduled' : 'incomplete', t: '1' + (drawMatchNr % 8) + ':' + (drawMatchNr % 4) + '0', dt: null,
  };
}
function groupDraw(di, name, entries) {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      DRAWS.push(Object.assign(node(di, name, 'G1', 5000 + DRAWS.length, entries[i], entries[j]), { sn: 'Gruppe A', dn: name + ' - Gruppe A' }));
    }
  }
}
const single = (n) => { const p = PEOPLE[n % PEOPLE.length]; return { p: [p.name], c: [p.club] }; };
const double = (n) => { const a = PEOPLE[n % PEOPLE.length], b = PEOPLE[(n + 7) % PEOPLE.length]; return { p: [a.name, b.name], c: [a.club, b.club] }; };
koDraw(1, 'HE O19', Array.from({ length: 12 }, (_, i) => single(i)));
koDraw(2, 'DE U17', Array.from({ length: 8 }, (_, i) => single(i + 20)));
groupDraw(3, 'HD U19', Array.from({ length: 4 }, (_, i) => double(i + 30)));
function randomScore() {
  const win = Math.random() < 0.5;
  const sets = [[21, 10 + Math.floor(Math.random() * 10)], [21, 8 + Math.floor(Math.random() * 12)]];
  return { w: win, s: sets.map(([a, b]) => (win ? [a, b] : [b, a])) };
}
// ein Spiel eines Felds beenden und den Sieger (bzw. Verlierer) weiterreichen
function advanceDraw() {
  const ready = DRAWS.filter((m) => m.w === null && m.p0.length && m.p1.length);
  if (!ready.length) return;
  const m = ready.sort((a, b) => a.mn - b.mn)[0];
  Object.assign(m, randomScore(), { st: 'finished' });
  const win = m.w ? { p: m.p0, c: m.c0 } : { p: m.p1, c: m.c1 };
  const lose = m.w ? { p: m.p1, c: m.c1 } : { p: m.p0, c: m.c0 };
  for (const [to, team] of [[m.wt, win], [m.lt, lose]]) {
    const t = to != null && DRAWS.find((x) => x.pl === to);
    if (!t) continue;
    if (t.f1 === m.pl) { t.p0 = team.p; t.c0 = team.c; } else { t.p1 = team.p; t.c1 = team.c; }
    if (t.p0.length && t.p1.length) t.st = 'scheduled';
  }
}
// zum Start schon ein paar Spiele gespielt
for (let i = 0; i < 9; i++) advanceDraw();

const ws = new WebSocket(url + '?password=' + encodeURIComponent(password));
const send = (msg) => ws.send(JSON.stringify(msg));
const NO_EXT = process.env.NO_EXT === '1';
const V1 = process.env.EXT === '1';
const V2 = process.env.EXT === '2';
const base = (m) => ({ _id: m._id, n: m.n, p0: m.p0, p1: m.p1, s: m.s, sf: m.sf });
// Spieldauer: Echtzeit × 20, damit sie nach einem Turnierspiel aussieht
const dur = (m) => (m.started ? (Date.now() - m.started) * 20 : null);
function plain(m) {
  if (NO_EXT) return base(m);
  const v1 = Object.assign(base(m), { d: m.d, ts: m.ts, pe: m.pe });
  if (V1) return v1;
  Object.assign(v1, { c0: m.c0, c1: m.c1, dur: dur(m) });
  if (!V2 && m.di) v1.di = m.di;
  return v1;
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
  if (!NO_EXT && !V1 && !V2) {
    event.xv = 3;
    event.draws = DRAWS;
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

let ticks = 0;
function tick() {
  if (++ticks % 40 === 0 && !NO_EXT && !V1 && !V2) { advanceDraw(); pushall(); }
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
