'use strict';

// Hält die Daten, die BTS über das Ticker-Protokoll schickt, und bereitet sie
// für Ticker- und Overlay-Seiten auf.
//
// BTS (bts/ticker_conn.js) sendet zwei Nachrichtentypen:
//   tset          { event: { courts, matches, tournament_name, tournament_url,
//                            tournament_logo, tournament_logo_mime,
//                            tournament_logo_background_color } }
//                 – kompletter Stand: alle Courts + die Spiele, die darauf liegen
//   tupdate_match { match: { _id, s } } – neuer Spielstand eines Spiels
// Ein Spiel: { _id, n (Name), p0/p1 (Spielernamen), s ([[h, a], …]), sf (Zählweise) }
// Mit der Erweiterung aus bts-patch/ zusätzlich (in tset und tupdate_match):
//   ts = Team 1 schlägt auf, pe = je Team: steht Spieler 1 im rechten (geraden) Feld,
//   d  = Doppel (nur tset)
//
// BTS schickt nur Spiele, die gerade auf einem Court liegen. Damit der Ticker
// auch Ergebnisse zeigen kann, merkt sich der Store jedes Spiel, das einmal
// auf einem Court war.

// Aktuelle Version der BTS-Erweiterung (bts-patch/); ältere zeigt das Admin-Panel als veraltet
const EXT_LATEST = 3;
const MAX_MATCHES = 400;   // so viele Spiele werden höchstens aufbewahrt
const MAX_PLANNED = 400;   // gemerkte Ansetzungszeiten noch nicht aufgerufener Spiele

function emptyStore() {
  return { tournament: {}, courts: [], matches: {}, updatedAt: null };
}

// Gespeicherten Stand prüfen und übernehmen. Fremde oder beschädigte Dateien
// (z. B. ein state.json des CourtSpot-Tickers) werfen einen Fehler.
function restore(saved) {
  if (!saved || typeof saved !== 'object') throw new Error('kein Objekt');
  if (!Array.isArray(saved.courts) || !saved.matches || typeof saved.matches !== 'object' ||
      Array.isArray(saved.matches) || !saved.tournament || typeof saved.tournament !== 'object') {
    throw new Error('unbekanntes Format');
  }
  const s = emptyStore();
  s.tournament = saved.tournament;
  s.courts = saved.courts
    .filter((c) => c && c.num != null && c.num !== '')
    .map((c) => ({ id: str(c.id), num: str(c.num), match: str(c.match) || null }));
  for (const [id, m] of Object.entries(saved.matches)) {
    if (m && m._id === id) s.matches[id] = m;
  }
  s.updatedAt = saved.updatedAt || null;
  if (typeof saved.extension === 'boolean') s.extension = saved.extension;
  if (typeof saved.extVersion === 'number') s.extVersion = saved.extVersion;
  if (Array.isArray(saved.upcoming)) s.upcoming = saved.upcoming;
  if (Array.isArray(saved.draws)) {
    s.draws = saved.draws;
    s.drawsVersion = saved.drawsVersion || null;
  }
  if (saved.planned && typeof saved.planned === 'object' && !Array.isArray(saved.planned)) s.planned = saved.planned;
  return s;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// „HE U15 undefined“ (BTS hängt match_name auch an, wenn es fehlt)
function cleanName(n) {
  return str(n)
    .replace(/\s+(undefined|null)$/, '')
    .replace(' - Qualification', ' Q')
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------- Zählweise

// Unterstützt das Objekt aus BTS/BTP ({ numSets, set_points, last_set_points })
// und bup-Kurzformen wie „3x21“, „5x11_15“, „3x15_21“.
function rules(sf) {
  const def = { bestOf: 3, set: { points: 21, cap: 30 }, last: { points: 21, cap: 30 } };
  if (!sf) return def;
  if (typeof sf === 'string') {
    const m = /^(\d+)x(\d+)(?:_(\d+))?/.exec(sf);
    if (!m) return def;
    const points = num(m[2], 21);
    const cap = m[3] ? num(m[3], points) : ({ 21: 30, 15: 21, 11: 15 }[points] || points);
    const set = { points, cap };
    return { bestOf: num(m[1], 3), set, last: set };
  }
  const bestOf = num(sf.numSets, 3) > 0 ? num(sf.numSets, 3) : 3;
  const sp = (p, fallback) => {
    if (!p || !num(p.end_points, 0)) return fallback;
    const points = num(p.end_points, 21);
    return { points, cap: Math.max(points, num(p.max_points, points)) };
  };
  const set = sp(sf.set_points, def.set);
  return { bestOf, set, last: sp(sf.last_set_points, set) };
}

function setWinner(h, a, r) {
  if ((h >= r.points && h - a >= 2) || h >= r.cap) return 'home';
  if ((a >= r.points && a - h >= 2) || a >= r.cap) return 'away';
  return null;
}

// Sätze, gewonnene Sätze und Sieger aus dem BTS-Spielstand berechnen
function score(s, sf) {
  const r = rules(sf);
  const toWin = Math.floor(r.bestOf / 2) + 1;
  const sets = [];
  const setsWon = [0, 0];
  (Array.isArray(s) ? s : []).slice(0, r.bestOf).forEach((g, i) => {
    if (!Array.isArray(g) || g.length < 2) return;
    const h = num(g[0], NaN);
    const a = num(g[1], NaN);
    if (!Number.isFinite(h) || !Number.isFinite(a)) return;
    const w = setWinner(h, a, i === r.bestOf - 1 ? r.last : r.set);
    if (w === 'home') setsWon[0]++;
    if (w === 'away') setsWon[1]++;
    sets.push({ home: h, away: a, winner: w });
  });
  // Ein angefangener, leerer Folgesatz (0:0) nach Spielende zählt nicht
  let winner = null;
  if (setsWon[0] >= toWin) winner = 'home';
  else if (setsWon[1] >= toWin) winner = 'away';
  if (winner) {
    while (sets.length && !sets[sets.length - 1].winner) sets.pop();
  }
  return { bestOf: r.bestOf, sets, setsWon, winner };
}

// ---------------------------------------------------------------- Änderungen

// Zeitstempel für „beendet“ pflegen. finishedAt = erstmals Sieger erkannt.
function stamp(m, now) {
  const { winner } = score(m.s, m.sf);
  // Spielbeginn = erster Spielstand (Ersatz für die Spieldauer ohne BTS-Erweiterung)
  if (!m.startedAt && Array.isArray(m.s) && m.s.length) m.startedAt = now;
  if (winner && !m.finishedAt) m.finishedAt = now;
  if (!winner && m.finishedAt) delete m.finishedAt;
}

function applyTset(store, event, now) {
  if (!event || !Array.isArray(event.courts) || !Array.isArray(event.matches)) {
    throw new Error('courts/matches fehlen');
  }
  for (const m of event.matches) if (!m || !m._id) throw new Error('Spiel ohne _id');
  for (const c of event.courts) if (!c || !c._id) throw new Error('Court ohne _id');

  const t = store.tournament;
  const name = str(event.tournament_name);
  // Neues Turnier in BTS → alte Ergebnisse verwerfen
  if (name && t.name && name !== t.name) {
    store.matches = {};
    delete store.planned;
  }
  if (name) t.name = name;
  t.url = str(event.tournament_url) || t.url || '';
  if (event.tournament_logo) {
    t.logo = String(event.tournament_logo);
    t.logoMime = str(event.tournament_logo_mime) || 'image/png';
    t.logoBg = str(event.tournament_logo_background_color) || null;
  } else {
    delete t.logo;
    delete t.logoMime;
    delete t.logoBg;
  }

  store.courts = event.courts.map((c) => ({
    id: str(c._id),
    num: str(c.num),
    match: str(c.match_id) || null,
  }));

  // Schickt BTS die Aufschlagdaten (Erweiterung aus bts-patch/)? Nur erkennbar,
  // wenn mindestens ein Spiel auf einem Court liegt.
  if (event.matches.length) store.extension = event.matches.some((m) => 'ts' in m);
  // Version der Erweiterung: ausdrücklich (xv, ab künftigen Versionen), sonst an den Daten erkannt
  if (typeof event.xv === 'number') store.extVersion = event.xv;
  else if (Array.isArray(event.upcoming)) store.extVersion = 2;
  else if (event.matches.length) store.extVersion = store.extension ? 1 : 0;

  for (const m of event.matches) {
    const id = str(m._id);
    const prev = store.matches[id] || { firstSeen: now };
    const next = Object.assign(prev, {
      _id: id,
      n: cleanName(m.n),
      p0: Array.isArray(m.p0) ? m.p0.map(str) : [],
      p1: Array.isArray(m.p1) ? m.p1.map(str) : [],
      sf: m.sf || m.c || prev.sf || null,   // ältere BTS-Versionen: c = Zählweise („3x21“)
      updatedAt: now,
    });
    const prevS = next.s;
    const prevTs = next.ts;
    if ('s' in m) next.s = Array.isArray(m.s) ? m.s : [];
    if ('d' in m) next.d = Boolean(m.d);
    if (Array.isArray(m.c0)) next.c0 = m.c0.map(str);
    if (Array.isArray(m.c1)) next.c1 = m.c1.map(str);
    if (m.di != null) next.di = str(m.di);
    takeService(next, m, prevS, prevTs);
    // Angesetzte Zeit aus „Als Nächstes“ merken (für den Verzug zum Zeitplan)
    if (store.planned && store.planned[id]) {
      if (!next.planned) next.planned = store.planned[id];
      delete store.planned[id];
    }
    store.matches[id] = next;
    stamp(next, now);
  }

  // Auf welchem Court lag ein Spiel zuletzt, und wann hat es ihn verlassen
  const onCourt = {};
  for (const c of store.courts) if (c.match) onCourt[c.match] = c.num;
  for (const m of Object.values(store.matches)) {
    if (onCourt[m._id]) {
      m.court = onCourt[m._id];
      delete m.leftAt;
    } else if (m.court && !m.leftAt) {
      m.leftAt = now;
    }
  }

  // Die nächsten Spiele (nur mit BTS-Erweiterung v2)
  if (Array.isArray(event.upcoming)) {
    store.upcoming = event.upcoming
      .filter((u) => u && u._id)
      .slice(0, 100)
      .map((u) => ({
        id: str(u._id),
        name: cleanName(u.n) || 'Spiel',
        home: Array.isArray(u.p0) ? u.p0.map(str) : [],
        away: Array.isArray(u.p1) ? u.p1.map(str) : [],
        homeClubs: Array.isArray(u.c0) ? u.c0.map(str) : [],
        awayClubs: Array.isArray(u.c1) ? u.c1.map(str) : [],
        time: str(u.t) || null,
        date: str(u.dt) || null,
        state: u.st === 'preparation' ? 'preparation' : 'scheduled',
        num: u.mn != null ? str(u.mn) : null,
        drawId: u.di != null ? str(u.di) : null,
      }));
    // Ansetzungszeiten merken, bis das Spiel auf einen Court kommt
    store.planned = store.planned || {};
    for (const u of store.upcoming) {
      if (u.time && !store.matches[u.id]) store.planned[u.id] = { time: u.time, date: u.date };
    }
    const ids = Object.keys(store.planned);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_PLANNED))) delete store.planned[id];
  } else if (event.matches.length) {
    delete store.upcoming;   // BTS ohne Erweiterung v2
  }

  // Alle Felder mit ihren Spielen (Turnierbäume, Erweiterung v3)
  if (Array.isArray(event.draws)) {
    const draws = buildDraws(event.draws);
    const version = require('crypto').createHash('sha1').update(JSON.stringify(draws)).digest('hex').slice(0, 12);
    if (version !== store.drawsVersion) {
      store.draws = draws;
      store.drawsVersion = version;
    }
  } else if (event.matches.length && !(store.extVersion >= 3)) {
    delete store.draws;
    delete store.drawsVersion;
  }

  prune(store);
  store.updatedAt = now;
}

// Felder aus den Spielen zusammenstellen: { id, name, event, stage, stageOrder, position,
// matches: [...], rankings } – sortiert nach Disziplin und Stufe
function buildDraws(list) {
  const byId = new Map();
  for (const x of list) {
    if (!x || x.di == null || !x._id) continue;
    const id = str(x.di);
    let d = byId.get(id);
    if (!d) {
      d = {
        id,
        name: cleanName(x.dn) || cleanName(x.en) || 'Feld',
        event: cleanName(x.en),
        stage: str(x.sn),
        stageOrder: num(x.so, 0),
        position: num(x.dp, 1),
        matches: [],
        rankings: null,
      };
      byId.set(id, d);
    }
    const sets = (Array.isArray(x.s) ? x.s : [])
      .filter((g) => Array.isArray(g) && g.length >= 2 && Number.isFinite(Number(g[0])) && Number.isFinite(Number(g[1])))
      .map((g) => ({ home: Number(g[0]), away: Number(g[1]) }))
      .filter((g) => g.home || g.away);
    d.matches.push({
      id: str(x._id),
      round: str(x.r),
      phase: str(x.ph),
      num: x.mn != null ? str(x.mn) : null,
      planning: x.pl != null ? str(x.pl) : null,
      from1: x.f1 != null ? str(x.f1) : null,
      from2: x.f2 != null ? str(x.f2) : null,
      winnerTo: x.wt != null ? str(x.wt) : null,
      loserTo: x.lt != null ? str(x.lt) : null,
      home: Array.isArray(x.p0) ? x.p0.map(str) : [],
      away: Array.isArray(x.p1) ? x.p1.map(str) : [],
      homeClubs: Array.isArray(x.c0) ? x.c0.map(str) : [],
      awayClubs: Array.isArray(x.c1) ? x.c1.map(str) : [],
      sets,
      winner: x.w === true ? 'home' : (x.w === false ? 'away' : null),
      state: str(x.st) || null,
      time: str(x.t) || null,
      date: str(x.dt) || null,
    });
    if (Array.isArray(x.rk) && !d.rankings) {
      d.rankings = x.rk
        .filter((r) => r && Array.isArray(r.n))
        .map((r) => ({ place: num(r.p, 0), names: r.n.map(str), clubs: Array.isArray(r.c) ? r.c.map(str) : [] }))
        .sort((a, b) => a.place - b.place);
    }
  }
  const draws = [...byId.values()];
  for (const d of draws) d.matches.sort((a, b) => num(a.num, 0) - num(b.num, 0));
  draws.sort((a, b) => a.event.localeCompare(b.event, 'de') || a.stageOrder - b.stageOrder ||
    a.position - b.position || a.name.localeCompare(b.name, 'de'));
  return draws;
}

// Liefert true, wenn sich der Spielstand tatsächlich geändert hat
function applyMatchUpdate(store, match, now) {
  if (!match || !match._id) throw new Error('Spiel ohne _id');
  const m = store.matches[str(match._id)];
  // Unbekanntes Spiel: kommt mit dem nächsten tset vollständig
  if (!m) return false;
  if ('ts' in match) store.extension = true;
  const before = JSON.stringify([m.s || [], m.ts, m.pe]);
  const prevS = m.s;
  const prevTs = m.ts;
  if ('s' in match) m.s = Array.isArray(match.s) ? match.s : [];
  takeService(m, match, prevS, prevTs);
  if (JSON.stringify([m.s || [], m.ts, m.pe]) === before) return false;
  m.updatedAt = now;
  stamp(m, now);
  store.updatedAt = now;
  return true;
}

// Aufschlagdaten und Spieldauer übernehmen (fehlen bei BTS ohne Erweiterung).
// Positionen (pe), die BTS nicht mitschickt, schreibt der Ticker nach den Regeln fort:
// Gewinnt das aufschlagende Team den Ballwechsel, wechselt sein Aufschläger das Feld;
// sonst bleiben alle stehen. Neuer Satz oder unklare Änderung → unbekannt.
function takeService(m, from, prevS, prevTs) {
  if ('dur' in from) m.dur = typeof from.dur === 'number' && from.dur >= 0 ? from.dur : null;
  if ('ts' in from) m.ts = typeof from.ts === 'boolean' ? from.ts : null;
  if (!('pe' in from) && !('ts' in from)) return;   // BTS ohne Erweiterung
  // Rohwert für die Fehlersuche (Admin-Panel / api/state)
  m.peRaw = 'pe' in from ? JSON.stringify(from.pe === undefined ? null : from.pe).slice(0, 80) : '(fehlt)';
  const given = Array.isArray(from.pe) && from.pe.length === 2
    ? from.pe.map((v) => (typeof v === 'boolean' ? v : null))
    : [null, null];
  const old = Array.isArray(m.pe) ? m.pe : [null, null];
  const derived = [0, 1].map((t) => advance(old[t], t, prevS, m.s, prevTs, m.ts));
  m.pe = given.map((v, t) => (v !== null ? v : derived[t]));
  if (m.pe[0] === null && m.pe[1] === null) m.pe = null;
  // Herkunft für das Admin-Panel
  if (given[0] !== null && given[1] !== null) m.peFrom = 'bts';
  else if (m.pe) m.peFrom = 'derived';
  else if (Array.isArray(from.pe) && from.pe.some((v) => v !== null && typeof v !== 'boolean')) m.peFrom = 'invalid';
  else m.peFrom = 'pe' in from && from.pe != null ? 'empty' : 'missing';
}

// Position eines Teams (Spieler 1 im rechten Feld?) nach der Änderung des Spielstands
function advance(p, t, prevS, s, prevTs, ts) {
  if (typeof p !== 'boolean' || !Array.isArray(prevS) || !Array.isArray(s)) return null;
  if (!prevS.length || prevS.length !== s.length) return null;      // neuer Satz
  const a = prevS[prevS.length - 1] || [];
  const b = s[s.length - 1] || [];
  const mine = num(b[t], 0) - num(a[t], 0);
  const theirs = num(b[1 - t], 0) - num(a[1 - t], 0);
  if (!mine && !theirs) return p;
  if (!mine && theirs === 1) return p;                               // Gegner punktet
  if (mine === 1 && !theirs) return prevTs === (t === 0) ? !p : p;   // eigener Aufschlag → Wechsel
  if (mine === -1 && !theirs) return ts === (t === 0) ? !p : p;      // Punkt zurückgenommen
  if (!mine && theirs === -1) return p;
  return null;                                                       // unklar (Korrektur o. ä.)
}

// Aufschläger und Rückschläger wie in BTS (determine_server/-_receiver in
// bts/bupws_v2.js): Steht Spieler 1 im geraden Feld und hat das Team eine
// gerade Punktzahl, schlägt Spieler 1 auf. Der Rückschläger steht diagonal
// gegenüber, also auf der Seite, die zur Punktzahl des Aufschlägerteams passt.
// Ergebnis: { server: { side, player }, receiver: { side, player } } oder null;
// player ist null, wenn nicht bekannt (z. B. Doppel zwischen zwei Sätzen).
function service(m, sc) {
  if (typeof m.ts !== 'boolean' || sc.winner) return null;
  const srv = m.ts ? 0 : 1;
  const rcv = 1 - srv;
  const sides = ['home', 'away'];
  const raw = Array.isArray(m.s) && m.s.length ? m.s[m.s.length - 1] : [0, 0];
  const cur = [num(raw && raw[0], 0), num(raw && raw[1], 0)];
  const doubles = m.d != null ? m.d : (m.p0 || []).length > 1;
  // Satz gerade beendet, nächster noch nicht begonnen
  const between = sc.sets.length > 0 && sc.sets.length === (m.s || []).length && sc.sets[sc.sets.length - 1].winner;
  const res = { server: { side: sides[srv], player: 0 }, receiver: { side: sides[rcv], player: 0 } };
  // Aufschlagfeld aus Sicht beider Teams (diagonal: beide im rechten bzw. linken Feld) –
  // auch bekannt, wenn BTS keine Positionen schickt; null zwischen zwei Sätzen
  res.serveCourt = between ? null : (cur[srv] % 2 === 0 ? 'R' : 'L');
  // Wo steht jeder Spieler: 'R' = rechtes (gerades) Aufschlagfeld, 'L' = linkes – aus Sicht
  // des jeweiligen Teams (für die Spielfeld-Ansicht).
  if (!doubles) {
    // Einzel: beide stehen im Feld, das zur Punktzahl des Aufschlägers passt
    const c = (between ? 0 : cur[srv]) % 2 === 0 ? 'R' : 'L';
    res.positions = { home: [c], away: [c] };
    return res;
  }
  if (!Array.isArray(m.pe)) {
    res.server.player = null;
    res.receiver.player = null;
    res.positions = null;
    return res;
  }
  const place = (t) => (m.pe[t] == null ? null : (m.pe[t] ? ['R', 'L'] : ['L', 'R']));
  res.positions = { home: place(0), away: place(1) };
  if (between) {
    res.server.player = null;
    res.receiver.player = null;
    return res;
  }
  const even = cur[srv] % 2 === 0;
  res.server.player = m.pe[srv] == null ? null : (m.pe[srv] === even ? 0 : 1);
  res.receiver.player = m.pe[rcv] == null ? null : (m.pe[rcv] === even ? 0 : 1);
  return res;
}

// Seitenwahl für die Spielfeld-Ansicht: Heim beginnt links, nach jedem Satz
// wird gewechselt, im Entscheidungssatz zusätzlich, sobald ein Team die Hälfte
// der Punkte erreicht (11 bei Sätzen bis 21, 6 bei Sätzen bis 11).
function homeLeft(m, sc) {
  const r = rules(m.sf);
  const raw = Array.isArray(m.s) ? m.s : [];
  const last = sc.sets[sc.sets.length - 1];
  const running = last && !last.winner && raw.length === sc.sets.length;
  let game;                                     // Index des aktuellen Satzes
  if (running || sc.winner) game = Math.max(0, sc.sets.length - 1);
  else game = sc.sets.length;                   // nächster Satz (noch 0:0)
  let left = game % 2 === 0;
  const inDecider = game === r.bestOf - 1 && (running || sc.winner);
  if (inDecider && Math.max(last.home, last.away) >= Math.ceil(r.last.points / 2)) left = !left;
  return left;
}

// Nicht mehr benötigte Spiele entfernen: nie gespielte, die vom Court
// genommen wurden, und die ältesten, wenn es zu viele werden.
function prune(store) {
  const onCourt = new Set(store.courts.map((c) => c.match).filter(Boolean));
  let list = Object.values(store.matches).filter((m) => {
    if (onCourt.has(m._id)) return true;
    return Array.isArray(m.s) && m.s.length > 0;
  });
  if (list.length > MAX_MATCHES) {
    list.sort((a, b) => sortTime(b).localeCompare(sortTime(a)));
    list = list.filter((m, i) => i < MAX_MATCHES || onCourt.has(m._id));
  }
  store.matches = {};
  for (const m of list) store.matches[m._id] = m;
}

function sortTime(m) {
  return m.finishedAt || m.leftAt || m.updatedAt || '';
}

// ---------------------------------------------------------------- Ansicht

function viewMatch(m, onCourt) {
  const sc = score(m.s, m.sf);
  const court = onCourt[m._id] || null;
  let status;
  if (sc.winner) status = 'finished';
  else if (court) status = sc.sets.length ? 'live' : 'called';
  else status = 'ended';   // vom Court genommen ohne Sieger (Aufgabe o. ä.)
  return {
    id: m._id,
    name: m.n || 'Spiel',
    home: m.p0 && m.p0.length ? m.p0 : [],
    away: m.p1 && m.p1.length ? m.p1 : [],
    homeClubs: m.c0 || [],
    awayClubs: m.c1 || [],
    bestOf: sc.bestOf,
    sets: sc.sets,
    setsWon: sc.setsWon,
    winner: sc.winner,
    status,
    service: status === 'live' || status === 'called' ? service(m, sc) : null,
    homeLeft: homeLeft(m, sc),
    court,
    lastCourt: m.court || null,
    finishedAt: m.finishedAt || (status === 'ended' ? m.leftAt || m.updatedAt : null) || null,
    startedAt: m.startedAt || null,
    duration: duration(m, sc),
    // für die Zeitplan-Schätzung: Ansetzung, Aufruf (erstmals auf einem Court), Court verlassen
    planned: m.planned || null,
    calledAt: m.firstSeen || null,
    leftAt: m.leftAt || null,
    doubles: m.d != null ? m.d : (m.p0 || []).length > 1,
    // Herkunft der Positionen: bts, derived (fortgeschrieben), empty (BTS schickt leer),
    // invalid (unbekanntes Format, z. B. aus einer Simulation), missing
    posFrom: m.peFrom || null,
    posRaw: m.peRaw || null,
    drawId: m.di || null,
    updatedAt: m.updatedAt || null,
  };
}

// Spieldauer in ms: von bup über BTS (Erweiterung) – sonst vom ersten Spielstand
// bis Spielende, wie der Liveticker es gesehen hat. Nur für beendete Spiele.
function duration(m, sc) {
  if (!sc.winner) return null;
  if (typeof m.dur === 'number' && m.dur > 0) return m.dur;
  if (m.startedAt && m.finishedAt) {
    const d = Date.parse(m.finishedAt) - Date.parse(m.startedAt);
    return d > 0 ? d : null;
  }
  return null;
}

// Ein einzelnes Spiel aufbereiten (für Spielstand-Updates zwischen zwei tset)
function viewOne(store, id) {
  const m = store.matches[id];
  if (!m) return null;
  const onCourt = {};
  for (const c of store.courts) if (c.match) onCourt[c.match] = c.num;
  return viewMatch(m, onCourt);
}

function logoVersion(t) {
  if (!t.logo) return null;
  return require('crypto').createHash('sha1').update(t.logo).digest('hex').slice(0, 12);
}

function view(store, extra) {
  const onCourt = {};
  for (const c of store.courts) if (c.match) onCourt[c.match] = c.num;
  const matches = Object.values(store.matches).map((m) => viewMatch(m, onCourt));

  const courts = store.courts
    .map((c) => ({ num: c.num, match: c.match && store.matches[c.match] ? c.match : null }))
    .sort((a, b) => num(a.num, 999) - num(b.num, 999) || String(a.num).localeCompare(String(b.num)));

  // Zuletzt auf jedem Court beendetes Spiel (für „zuletzt gespielt“ / Overlays)
  for (const c of courts) {
    let last = null;
    for (const m of matches) {
      if (m.court || m.lastCourt !== c.num || !m.finishedAt) continue;
      if (!last || m.finishedAt > last.finishedAt) last = m;
    }
    c.last = last ? last.id : null;
  }

  const t = store.tournament || {};
  return Object.assign({
    tournament: {
      name: t.name || '',
      url: t.url || '',
      logo: logoVersion(t),
      logoBg: t.logoBg || null,
    },
    courts,
    matches,
    // true/false: BTS-Erweiterung für Aufschläger aktiv; null: noch nicht erkennbar
    btsExtension: typeof store.extension === 'boolean' ? store.extension : null,
    // Version der BTS-Erweiterung (0 = keine, null = noch nicht erkennbar) und die aktuelle
    btsExtVersion: typeof store.extVersion === 'number' ? store.extVersion : null,
    btsExtLatest: EXT_LATEST,
    // Turnierbäume (Erweiterung v3): Abruf über /api/draws, Version zum Neuladen
    drawsVersion: Array.isArray(store.draws) ? store.drawsVersion : null,
    // Die nächsten Spiele – null, wenn BTS sie nicht schickt (Erweiterung v2 fehlt)
    upcoming: Array.isArray(store.upcoming) ? store.upcoming : null,
    updatedAt: store.updatedAt,
  }, extra || {});
}

function drawsView(store) {
  return { version: store.drawsVersion || null, draws: Array.isArray(store.draws) ? store.draws : null };
}

module.exports = {
  drawsView, emptyStore, restore, applyTset, applyMatchUpdate, view, viewOne, viewMatch, score, rules, cleanName, logoVersion,
};
