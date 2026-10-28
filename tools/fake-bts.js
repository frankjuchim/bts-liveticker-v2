'use strict';

// Simuliert BTS: verbindet sich wie bts/ticker_conn.js mit dem Liveticker und
// spielt auf mehreren Courts Spiele durch.
//   node tools/fake-bts.js ws://localhost:8080/ws/update test [courts] [ms pro Punkt]
// NO_EXT=1 simuliert ein BTS ohne Erweiterung (ohne Aufschlagdaten).

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

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const person = () => pick(FIRST) + ' ' + pick(LAST);

let nextId = 1;
const courts = [];
for (let i = 1; i <= COURTS; i++) courts.push({ _id: 'court_' + i, num: i, match_id: null });
const matches = new Map();

function newMatch() {
  const ev = pick(EVENTS);
  const doubles = /^(HD|DD|GD)/.test(ev);
  const team = () => (doubles ? [person(), person()] : [person()]);
  const m = {
    _id: 'match_' + nextId++, n: ev + ' ' + pick(ROUNDS), p0: team(), p1: team(), s: [], sf: SF,
    d: doubles, ts: Math.random() < 0.5, pe: [true, true],   // wie BTS mit Erweiterung aus bts-patch/
  };
  matches.set(m._id, m);
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
const plain = (m) => (NO_EXT ? { _id: m._id, n: m.n, p0: m.p0, p1: m.p1, s: m.s, sf: m.sf } : m);
const pushall = () => send({
  type: 'tset',
  event: {
    courts,
    matches: courts.filter((c) => c.match_id).map((c) => plain(matches.get(c.match_id))),
    tournament_name: 'Muster Open (Test)',
    tournament_url: 'https://www.turnier.de/tournaments/',
  },
});

ws.on('open', () => {
  console.log('verbunden');
  courts.forEach((c, i) => { if (i < COURTS - 1) c.match_id = newMatch()._id; });
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
    if (Math.random() < 0.2) { c.match_id = newMatch()._id; pushall(); }
    return;
  }
  const m = matches.get(c.match_id);
  if (finished(m)) {
    // Court wieder freigeben (BTS: nach Bestätigung des Ergebnisses)
    if (Math.random() < 0.3) { c.match_id = null; pushall(); }
    return;
  }
  if (!m.s.length || setDone(...m.s[m.s.length - 1])) m.s.push([0, 0]);
  const g = m.s[m.s.length - 1];
  const won = Math.random() < 0.5 ? 0 : 1;
  const srv = m.ts ? 0 : 1;
  g[won]++;
  // Badmintonregeln: gewinnt das aufschlagende Team, wechselt der Aufschläger
  // das Feld; sonst geht der Aufschlag ohne Positionswechsel zum Gegner.
  if (won === srv) m.pe[srv] = !m.pe[srv];
  else m.ts = won === 0;
  send({ type: 'tupdate_match', match: NO_EXT ? { _id: m._id, s: m.s } : { _id: m._id, s: m.s, ts: m.ts, pe: m.pe } });
}
