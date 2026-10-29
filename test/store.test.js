'use strict';

const test = require('node:test');
const assert = require('node:assert');
const store = require('../lib/store');

// nur Aufschläger/Rückschläger vergleichen (ohne Positionen)
const sr = (x) => (x ? { server: x.server, receiver: x.receiver } : x);

const SF_3x21 = {
  numSets: 3,
  set_points: { end_points: 21, max_points: 30 },
  last_set_points: { end_points: 21, max_points: 30 },
};

function event(courts, matches, extra) {
  return Object.assign({ courts, matches, tournament_name: 'Muster Open', tournament_url: 'https://www.turnier.de/tournament/x/matches' }, extra);
}

const m1 = { _id: 'm1', n: 'HE U15 VF', p0: ['Max Mustermann'], p1: ['Tim Test'], s: [[21, 15], [4, 3]], sf: SF_3x21 };

test('Zählweise: Satzende, Verlängerung, 30. Punkt', () => {
  const r = store.score([[21, 19], [20, 22], [30, 29]], SF_3x21);
  assert.deepStrictEqual(r.sets.map((s) => s.winner), ['home', 'away', 'home']);
  assert.strictEqual(r.winner, 'home');
  assert.deepStrictEqual(r.setsWon, [2, 1]);
  assert.strictEqual(store.score([[21, 20]], SF_3x21).sets[0].winner, null);
});

test('Zählweise aus bup-Kurzform und 5x11', () => {
  const r = store.score([[11, 9], [11, 5], [11, 13]], '5x11_15');
  assert.strictEqual(r.bestOf, 5);
  assert.deepStrictEqual(r.setsWon, [2, 1]);
  assert.strictEqual(r.winner, null);
  assert.strictEqual(store.score([[15, 14]], '5x11_15').sets[0].winner, 'home');
});

test('Leerer Folgesatz nach Spielende wird ignoriert', () => {
  const r = store.score([[21, 10], [21, 12], [0, 0]], SF_3x21);
  assert.strictEqual(r.winner, 'home');
  assert.strictEqual(r.sets.length, 2);
});

test('Name ohne Runde (undefined) wird bereinigt', () => {
  assert.strictEqual(store.cleanName('HE U15 undefined'), 'HE U15');
  assert.strictEqual(store.cleanName('DD - Qualification R1'), 'DD Q R1');
});

test('tset + tupdate_match: live → beendet → Ergebnis bleibt nach Court-Freigabe', () => {
  const s = store.emptyStore();
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm1' }, { _id: 'c2', num: 2 }], [m1]), 't1');
  let v = store.view(s);
  assert.strictEqual(v.tournament.name, 'Muster Open');
  assert.deepStrictEqual(v.courts.map((c) => [c.num, c.match]), [['1', 'm1'], ['2', null]]);
  assert.strictEqual(v.matches[0].status, 'live');
  assert.strictEqual(v.matches[0].court, '1');

  assert.strictEqual(store.applyMatchUpdate(s, { _id: 'm1', s: [[21, 15], [4, 3]] }, 't2'), false, 'unverändert');
  assert.ok(store.applyMatchUpdate(s, { _id: 'm1', s: [[21, 15], [21, 18]] }, 't3'));
  let m = store.viewOne(s, 'm1');
  assert.strictEqual(m.status, 'finished');
  assert.strictEqual(m.winner, 'home');
  assert.strictEqual(m.finishedAt, 't3');

  // BTS gibt den Court frei – Spiel kommt nicht mehr mit
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: null }, { _id: 'c2', num: 2 }], []), 't4');
  v = store.view(s);
  m = v.matches.find((x) => x.id === 'm1');
  assert.strictEqual(m.status, 'finished');
  assert.strictEqual(m.court, null);
  assert.strictEqual(m.lastCourt, '1');
  assert.strictEqual(v.courts[0].last, 'm1');
});

test('Aufgerufenes, nie gespieltes Spiel verschwindet wieder', () => {
  const s = store.emptyStore();
  const called = { _id: 'm2', n: 'DE O19', p0: ['A B'], p1: ['C D'], sf: SF_3x21 };
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm2' }], [called]), 't1');
  assert.strictEqual(store.view(s).matches[0].status, 'called');
  store.applyTset(s, event([{ _id: 'c1', num: 1 }], []), 't2');
  assert.strictEqual(store.view(s).matches.length, 0);
});

test('Spiel ohne Sieger vom Court genommen → „ended“', () => {
  const s = store.emptyStore();
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm1' }], [m1]), 't1');
  store.applyTset(s, event([{ _id: 'c1', num: 1 }], []), 't2');
  const m = store.view(s).matches[0];
  assert.strictEqual(m.status, 'ended');
  assert.strictEqual(m.finishedAt, 't2');
});

test('Neuer Turniername verwirft alte Ergebnisse', () => {
  const s = store.emptyStore();
  store.applyTset(s, event([{ _id: 'c1', num: 1 }], []), 't0');
  s.matches.old = { _id: 'old', n: 'X', p0: [], p1: [], s: [[21, 0], [21, 0]], finishedAt: 't0' };
  store.applyTset(s, event([{ _id: 'c1', num: 1 }], [], { tournament_name: 'Anderes Turnier' }), 't1');
  assert.deepStrictEqual(Object.keys(s.matches), []);
});

test('Logo wird übernommen und versioniert', () => {
  const s = store.emptyStore();
  store.applyTset(s, event([], [], { tournament_logo: 'aGFsbG8=', tournament_logo_mime: 'image/png', tournament_logo_background_color: '#fff' }), 't1');
  const v = store.view(s);
  assert.match(v.tournament.logo, /^[0-9a-f]{12}$/);
  assert.strictEqual(v.tournament.logoBg, '#fff');
});

test('Unvollständige Daten werden abgelehnt', () => {
  const s = store.emptyStore();
  assert.throws(() => store.applyTset(s, { courts: [] }, 't'));
  assert.throws(() => store.applyTset(s, event([{ num: 1 }], []), 't'));
  assert.throws(() => store.applyMatchUpdate(s, {}, 't'));
});

test('Gespeicherter Stand: eigenes Format wird übernommen, fremdes verworfen', () => {
  const s = store.emptyStore();
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm1' }], [m1]), 't1');
  const back = store.restore(JSON.parse(JSON.stringify(s)));
  assert.deepStrictEqual(store.view(back), store.view(s));
  // state.json des CourtSpot-Tickers
  assert.throws(() => store.restore({ spiele: [], courts: [{ AnzeigeID: 1 }], verwaltung: {} }));
  assert.throws(() => store.restore(null));
  // Courts ohne Nummer werden ignoriert statt abzustürzen
  const odd = store.restore({ tournament: {}, courts: [{ AnzeigeID: 1 }, { num: '2' }], matches: {} });
  assert.deepStrictEqual(store.view(odd).courts.map((c) => c.num), ['2']);
});

test('Aufschlag: ohne BTS-Erweiterung keine Angabe', () => {
  const s = store.emptyStore();
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm1' }], [m1]), 't1');
  assert.strictEqual(store.view(s).matches[0].service, null);
});

test('Aufschlag im Einzel: Team bestimmt Aufschläger', () => {
  const s = store.emptyStore();
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm1' }], [Object.assign({}, m1, { ts: false, pe: [true, true], d: false })]), 't1');
  assert.deepStrictEqual(sr(store.viewOne(s, 'm1').service), {
    server: { side: 'away', player: 0 }, receiver: { side: 'home', player: 0 },
  });
});

test('Aufschlag im Doppel: Position aus Spielstand und Feldseite (wie BTS)', () => {
  const s = store.emptyStore();
  const dbl = { _id: 'd1', n: 'HD O19', p0: ['A A', 'B B'], p1: ['C C', 'D D'], s: [[0, 0]], sf: SF_3x21, d: true, ts: true, pe: [true, true] };
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'd1' }], [dbl]), 't1');
  // 0:0, Heim schlägt auf, Spieler 1 steht rechts (gerade) → Spieler 1 schlägt auf, Gegner-Spieler 1 nimmt an
  assert.deepStrictEqual(sr(store.viewOne(s, 'd1').service), {
    server: { side: 'home', player: 0 }, receiver: { side: 'away', player: 0 },
  });
  // Heim gewinnt den Ballwechsel → 1:0, Aufschläger wechselt das Feld (pe[0] kippt)
  assert.ok(store.applyMatchUpdate(s, { _id: 'd1', s: [[1, 0]], ts: true, pe: [false, true] }, 't2'));
  assert.deepStrictEqual(sr(store.viewOne(s, 'd1').service), {
    server: { side: 'home', player: 0 }, receiver: { side: 'away', player: 1 },
  });
  // Gast gewinnt → 1:1, Aufschlag Gast, ungerade → Spieler im linken Feld
  assert.ok(store.applyMatchUpdate(s, { _id: 'd1', s: [[1, 1]], ts: false, pe: [false, true] }, 't3'));
  assert.deepStrictEqual(sr(store.viewOne(s, 'd1').service), {
    server: { side: 'away', player: 1 }, receiver: { side: 'home', player: 0 },
  });
  // Nur Aufschlag geändert (Punktestand gleich) zählt auch als Änderung
  assert.ok(store.applyMatchUpdate(s, { _id: 'd1', s: [[1, 1]], ts: true, pe: [false, true] }, 't4'));
  // Satzende: Spieler unbekannt, Team bleibt
  store.applyMatchUpdate(s, { _id: 'd1', s: [[21, 1]], ts: true, pe: [false, true] }, 't5');
  assert.deepStrictEqual(sr(store.viewOne(s, 'd1').service), {
    server: { side: 'home', player: null }, receiver: { side: 'away', player: null },
  });
  // Spielende: keine Anzeige
  store.applyMatchUpdate(s, { _id: 'd1', s: [[21, 1], [21, 3]], ts: true, pe: [false, true] }, 't6');
  assert.strictEqual(store.viewOne(s, 'd1').service, null);
});

test('Ältere BTS-Versionen: Zählweise als c („5x11_15“)', () => {
  const s = store.emptyStore();
  const old = { _id: 'o1', n: 'HE', p0: ['A A'], p1: ['B B'], s: [[11, 5], [11, 7], [11, 9]], c: '5x11_15' };
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'o1' }], [old]), 't1');
  const m = store.viewOne(s, 'o1');
  assert.strictEqual(m.bestOf, 5);
  assert.strictEqual(m.winner, 'home');
});

test('Erkennt, ob BTS die Aufschlag-Erweiterung hat', () => {
  const s = store.emptyStore();
  store.applyTset(s, event([], []), 't0');
  assert.strictEqual(store.view(s).btsExtension, null, 'ohne Spiele nicht erkennbar');
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm1' }], [m1]), 't1');
  assert.strictEqual(store.view(s).btsExtension, false);
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm1' }], [Object.assign({}, m1, { ts: true, pe: [true, true] })]), 't2');
  assert.strictEqual(store.view(s).btsExtension, true);
  assert.strictEqual(store.view(store.restore(JSON.parse(JSON.stringify(s)))).btsExtension, true);
});

test('Positionen für die Spielfeld-Ansicht', () => {
  const s = store.emptyStore();
  const dbl = { _id: 'd1', n: 'HD', p0: ['A A', 'B B'], p1: ['C C', 'D D'], s: [[3, 2]], sf: SF_3x21, d: true, ts: false, pe: [true, false] };
  const sgl = { _id: 's1', n: 'HE', p0: ['E E'], p1: ['F F'], s: [[4, 7]], sf: SF_3x21, d: false, ts: false };
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'd1' }, { _id: 'c2', num: 2, match_id: 's1' }], [dbl, sgl]), 't1');
  const d = store.viewOne(s, 'd1').service;
  assert.deepStrictEqual(d.positions, { home: ['R', 'L'], away: ['L', 'R'] });
  // Gast schlägt bei 2 (gerade) aus dem rechten Feld auf → Spieler 2 (steht rechts); Heim nimmt rechts an → Spieler 1
  assert.deepStrictEqual([d.server.player, d.receiver.player], [1, 0]);
  // Einzel: Aufschläger hat 7 (ungerade) → beide im linken Feld
  assert.deepStrictEqual(store.viewOne(s, 's1').service.positions, { home: ['L'], away: ['L'] });
});

test('Seitenwahl: Heim links, Wechsel nach jedem Satz und bei 11 im Entscheidungssatz', () => {
  const s = store.emptyStore();
  const left = (score) => {
    store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'x' }],
      [{ _id: 'x', n: 'HE', p0: ['A A'], p1: ['B B'], s: score, sf: SF_3x21 }]), 't');
    return store.viewOne(s, 'x').homeLeft;
  };
  assert.strictEqual(left([]), true, 'vor dem ersten Punkt');
  assert.strictEqual(left([[10, 8]]), true, '1. Satz');
  assert.strictEqual(left([[21, 8]]), false, 'nach dem 1. Satz (Pause)');
  assert.strictEqual(left([[21, 8], [3, 4]]), false, '2. Satz');
  assert.strictEqual(left([[21, 8], [15, 21]]), true, 'Pause vor dem 3. Satz');
  assert.strictEqual(left([[21, 8], [15, 21], [10, 7]]), true, '3. Satz vor 11');
  assert.strictEqual(left([[21, 8], [15, 21], [11, 7]]), false, '3. Satz ab 11');
  assert.strictEqual(left([[21, 8], [15, 21], [21, 17]]), false, 'Spielende');
});

test('Erweiterung v2: Vereine, Spieldauer und die nächsten Spiele', () => {
  const s = store.emptyStore();
  const live = Object.assign({}, m1, { ts: true, pe: [true, true], d: false, c0: ['TV Metjendorf'], c1: ['BC Oldenburg'], dur: 60000 });
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm1' }], [live], {
    upcoming: [
      { _id: 'u1', n: 'HD U19 undefined', p0: ['A A', 'B B'], p1: ['C C', 'D D'], c0: ['X', 'X'], c1: ['Y', 'Y'], t: '14:30', dt: '2026-11-01', st: 'preparation', mn: 7 },
      { _id: 'u2', n: 'DE', p0: ['E E'], p1: ['F F'], t: '15:00', st: 'scheduled' },
    ],
  }), '2026-11-01T10:00:00.000Z');
  let v = store.view(s);
  assert.deepStrictEqual(v.matches[0].homeClubs, ['TV Metjendorf']);
  assert.strictEqual(v.upcoming.length, 2);
  assert.deepStrictEqual(v.upcoming[0], {
    id: 'u1', name: 'HD U19', home: ['A A', 'B B'], away: ['C C', 'D D'], homeClubs: ['X', 'X'], awayClubs: ['Y', 'Y'],
    time: '14:30', date: '2026-11-01', state: 'preparation', num: '7',
  });
  // Spieldauer aus BTS (bup), sobald das Spiel beendet ist
  assert.strictEqual(v.matches[0].duration, null, 'läuft noch');
  store.applyMatchUpdate(s, { _id: 'm1', s: [[21, 15], [21, 18]], ts: true, pe: [true, true], dur: 1860000 }, '2026-11-01T10:31:00.000Z');
  assert.strictEqual(store.viewOne(s, 'm1').duration, 1860000);
  // gespeicherter Stand behält die nächsten Spiele
  assert.strictEqual(store.view(store.restore(JSON.parse(JSON.stringify(s)))).upcoming.length, 2);
  // BTS ohne Erweiterung v2 → keine nächsten Spiele
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm1' }], [m1]), 't');
  assert.strictEqual(store.view(s).upcoming, null);
});

test('Spieldauer ohne BTS-Erweiterung: vom ersten Spielstand bis Spielende', () => {
  const s = store.emptyStore();
  store.applyTset(s, event([{ _id: 'c1', num: 1, match_id: 'm1' }], [Object.assign({}, m1, { s: [[1, 0]] })]), '2026-11-01T10:00:00.000Z');
  store.applyMatchUpdate(s, { _id: 'm1', s: [[21, 15], [21, 18]] }, '2026-11-01T10:25:00.000Z');
  assert.strictEqual(store.viewOne(s, 'm1').duration, 25 * 60000);
});

test('Zeitplan: Ansetzung wird gemerkt, bis das Spiel aufgerufen wird', () => {
  const s = store.emptyStore();
  const up = { _id: 'u1', n: 'HE', p0: ['A'], p1: ['B'], t: '14:20', dt: '2026-10-29', st: 'scheduled' };
  store.applyTset(s, { courts: [{ _id: 'c1', num: 1 }], matches: [], upcoming: [up] }, '2026-10-29T12:00:00.000Z');
  assert.deepStrictEqual(s.planned.u1, { time: '14:20', date: '2026-10-29' });
  store.applyTset(s, {
    courts: [{ _id: 'c1', num: 1, match_id: 'u1' }],
    matches: [{ _id: 'u1', n: 'HE', p0: ['A'], p1: ['B'], s: [] }],
    upcoming: [],
  }, '2026-10-29T13:45:00.000Z');
  const m = store.view(s).matches[0];
  assert.deepStrictEqual(m.planned, { time: '14:20', date: '2026-10-29' });
  assert.strictEqual(m.calledAt, '2026-10-29T13:45:00.000Z');
  assert.strictEqual(m.doubles, false);
  assert.strictEqual(s.planned.u1, undefined);
  // bleibt nach Neustart erhalten
  const r = store.restore(JSON.parse(JSON.stringify(s)));
  assert.deepStrictEqual(store.view(r).matches[0].planned, { time: '14:20', date: '2026-10-29' });
});

test('Aufschlagfeld auch ohne Positionen im Doppel', () => {
  const s = store.emptyStore();
  store.applyTset(s, {
    courts: [{ _id: 'c1', num: 1, match_id: 'm' }],
    matches: [{ _id: 'm', n: 'MX', p0: ['A', 'B'], p1: ['C', 'D'], s: [[21, 14], [21, 20]], sf: SF_3x21, d: true, ts: true }],
  }, '2026-10-29T10:00:00.000Z');
  const sv = store.view(s).matches[0].service;
  assert.strictEqual(sv.server.side, 'home');
  assert.strictEqual(sv.server.player, null);
  assert.strictEqual(sv.positions, null);
  assert.strictEqual(sv.serveCourt, 'L');   // 21 Punkte: ungerade → linkes Feld
});

test('Positionen im Doppel fortschreiben, wenn BTS sie nicht mitschickt', () => {
  const s = store.emptyStore();
  store.applyTset(s, {
    courts: [{ _id: 'c1', num: 1, match_id: 'm' }],
    matches: [{ _id: 'm', n: 'HD', p0: ['A', 'B'], p1: ['C', 'D'], s: [[0, 0]], sf: SF_3x21, d: true, ts: true, pe: [true, true] }],
  }, '2026-10-29T10:00:00.000Z');
  const sv = () => store.view(s).matches[0].service;
  assert.deepStrictEqual(sr(sv()), { server: { side: 'home', player: 0 }, receiver: { side: 'away', player: 0 } });
  // Heim punktet bei eigenem Aufschlag: A wechselt nach links und schlägt wieder auf (1 = ungerade)
  store.applyMatchUpdate(s, { _id: 'm', s: [[1, 0]], ts: true, pe: null }, '2026-10-29T10:01:00.000Z');
  assert.deepStrictEqual(sr(sv()), { server: { side: 'home', player: 0 }, receiver: { side: 'away', player: 1 } });
  assert.strictEqual(store.view(s).matches[0].posFrom, 'derived');
  // Gast gewinnt den Ballwechsel: Aufschlagwechsel, niemand wechselt das Feld; Gast hat 1 → linkes Feld
  store.applyMatchUpdate(s, { _id: 'm', s: [[1, 1]], ts: false, pe: null }, '2026-10-29T10:02:00.000Z');
  assert.deepStrictEqual(sr(sv()), { server: { side: 'away', player: 1 }, receiver: { side: 'home', player: 0 } });
  // neuer Satz: Positionen wieder unbekannt
  store.applyMatchUpdate(s, { _id: 'm', s: [[21, 1], [0, 0]], ts: true, pe: null }, '2026-10-29T10:03:00.000Z');
  assert.strictEqual(sv().server.player, null);
  assert.strictEqual(store.view(s).matches[0].posFrom, 'missing');   // BTS hat keine Positionen gespeichert
  store.applyMatchUpdate(s, { _id: 'm', s: [[21, 1], [1, 0]], ts: true, pe: [null, null] }, '2026-10-29T10:04:00.000Z');
  assert.strictEqual(store.view(s).matches[0].posFrom, 'empty');     // bup kennt sie nicht (nicht ausgewählt)
});
