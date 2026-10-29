// Zeitplan-Schätzung (nur mit BTS-Erweiterung v2, die die Ansetzungen schickt):
//   Verzug  = Median aus „Aufruf – angesetzte Zeit“ der zuletzt aufgerufenen Spiele
//   Beginn  = die nächsten Spiele der Reihe nach auf den jeweils zuerst frei werdenden
//             Court verteilt; Belegung je Court aus den bisherigen Spielen (Einzel/Doppel
//             getrennt), Spieler, die noch spielen, frühestens nach ihrem Spiel.
// Alles im Browser in Ortszeit, damit die Uhrzeiten aus BTS passen.
(function (root) {
  'use strict';
  var MIN = 60000;
  var DEFAULT_SLOT = { s: 30 * MIN, d: 35 * MIN };   // Aufruf bis Court frei, ohne Erfahrungswerte
  var CHANGE = 2 * MIN;                              // Court frei → nächster Aufruf
  var REST = 5 * MIN;                                // Spieler: Spielende → nächstes Spiel frühestens
  var MIN_SAMPLES = 3;

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var h = Math.floor(s.length / 2);
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }

  // { time: '14:20', date: '2026-10-29' } → ms in Ortszeit (ohne Datum: Tag von ref)
  function plannedMs(p, ref) {
    if (!p || !/^\d{1,2}:\d{2}/.test(p.time || '')) return null;
    var hm = p.time.split(':');
    var d = new Date(ref);
    if (p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
      var dt = p.date.split('-');
      d = new Date(+dt[0], +dt[1] - 1, +dt[2]);
    }
    d.setHours(+hm[0], +hm[1], 0, 0);
    return d.getTime();
  }

  function isDoubles(m) {
    if (typeof m.doubles === 'boolean') return m.doubles;
    return (m.home || []).length > 1 || (m.away || []).length > 1;
  }

  function sameDay(a, b) {
    var x = new Date(a);
    var y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  function compute(state, now) {
    now = now || Date.now();
    // Testmodus (Admin-Panel): Datum der Ansetzungen ignorieren, nur die Uhrzeit zählt
    var noDate = !!(state && state.testMode);
    var at = function (p, ref) { return plannedMs(p && noDate ? { time: p.time } : p, ref); };
    var res = { testMode: noDate, delay: null, delaySamples: 0, slot: { s: DEFAULT_SLOT.s, d: DEFAULT_SLOT.d }, slotSamples: { s: 0, d: 0 }, courts: 0, eta: {} };
    if (!state || !Array.isArray(state.upcoming)) return res;
    var matches = state.matches || [];
    var byId = {};
    matches.forEach(function (m) { byId[m.id] = m; });

    // ---- Verzug: die zuletzt aufgerufenen Spiele der letzten 4 Stunden mit Ansetzung
    var called = matches
      .filter(function (m) { return m.planned && m.calledAt && now - Date.parse(m.calledAt) < 4 * 60 * MIN; })
      .sort(function (a, b) { return Date.parse(b.calledAt) - Date.parse(a.calledAt); })
      .slice(0, 8)
      .map(function (m) {
        var c = Date.parse(m.calledAt);
        var p = at(m.planned, c);
        return p == null ? null : c - p;
      })
      .filter(function (d) { return d != null && Math.abs(d) < 12 * 60 * MIN; });
    if (called.length >= 2) {
      res.delay = median(called);
      res.delaySamples = called.length;
    }

    // ---- Belegung eines Courts je Spiel: Aufruf bis Court frei, sonst Spieldauer + 8 min
    ['s', 'd'].forEach(function (k) {
      var done = matches
        .filter(function (m) { return isDoubles(m) === (k === 'd') && (m.status === 'finished' || m.status === 'ended'); })
        .sort(function (a, b) { return (b.finishedAt || '').localeCompare(a.finishedAt || ''); });
      var occ = done
        .filter(function (m) { return m.calledAt && m.leftAt; })
        .map(function (m) { return Date.parse(m.leftAt) - Date.parse(m.calledAt); })
        .filter(function (d) { return d > 5 * MIN && d < 3 * 60 * MIN; })
        .slice(0, 12);
      if (occ.length < MIN_SAMPLES) {
        occ = done
          .filter(function (m) { return m.duration > 5 * MIN && m.duration < 3 * 60 * MIN; })
          .map(function (m) { return m.duration + 8 * MIN; })
          .slice(0, 12);
      }
      if (occ.length >= MIN_SAMPLES) {
        res.slot[k] = median(occ);
        res.slotSamples[k] = occ.length;
      }
    });
    var slot = function (m) { return res.slot[isDoubles(m) ? 'd' : 's']; };

    // ---- Wann wird jeder Court frei, wann sind die Spieler frei
    var free = [];
    var busy = {};
    (state.courts || []).forEach(function (c) {
      var m = c.match && byId[c.match];
      var t = now;
      if (m && (m.status === 'live' || m.status === 'called')) {
        var start = m.calledAt ? Date.parse(m.calledAt) : now;
        t = Math.max(start + slot(m), now + 3 * MIN);   // überzogene Spiele: gleich fertig
        (m.home || []).concat(m.away || []).forEach(function (n) { if (n) busy[n] = t; });
      } else if (m) {
        t = now + CHANGE;                               // beendet, Court noch nicht freigegeben
      }
      free.push(t);
    });
    res.courts = free.length;
    if (!free.length) return res;

    // ---- Die nächsten Spiele der Reihe nach verteilen
    state.upcoming.slice(0, 60).forEach(function (u) {
      var p = at({ time: u.time, date: u.date }, now);
      if (!noDate && u.date && p != null && !sameDay(p, now)) return;   // andere Turniertage nicht schätzen
      // frühestens: Spieler frei und – außer schon in Vorbereitung – nicht vor der Ansetzung
      var players = (u.home || []).concat(u.away || []).filter(Boolean);
      var ready = now;
      players.forEach(function (n) { if (busy[n]) ready = Math.max(ready, busy[n] + REST); });
      if (p != null && u.state !== 'preparation') ready = Math.max(ready, p);
      var ok = function (k) { return Math.max(free[k] + (free[k] > now ? CHANGE : 0), now); };
      // Court, der bis dahin frei ist und am spätesten frei wird (die früheren bleiben für
      // die folgenden Spiele), sonst der zuerst frei werdende
      var i = -1;
      for (var k = 0; k < free.length; k++) {
        if (ok(k) <= ready && (i < 0 || free[k] > free[i])) i = k;
      }
      if (i < 0) {
        i = 0;
        for (k = 1; k < free.length; k++) if (free[k] < free[i]) i = k;
      }
      var t = Math.max(ok(i), ready);
      res.eta[u.id] = t;
      free[i] = t + slot(u);
      players.forEach(function (n) { busy[n] = t + slot(u); });
    });
    return res;
  }

  // ---- Texte

  function round5(ms) { return Math.round(ms / (5 * MIN)) * 5; }

  function clock(ms) {
    var d = new Date(Math.round(ms / (5 * MIN)) * 5 * MIN);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // „ca. 25 min Verzug“, „im Zeitplan“, „ca. 10 min vor dem Zeitplan“
  function delayText(ms) {
    if (ms == null) return '';
    var min = round5(ms);
    if (Math.abs(min) < 5) return 'im Zeitplan';
    var abs = Math.abs(min);
    var txt = abs >= 60 ? Math.floor(abs / 60) + ':' + String(abs % 60).padStart(2, '0') + ' h' : abs + ' min';
    return 'ca. ' + txt + (min > 0 ? ' Verzug' : ' vor dem Zeitplan');
  }

  // Erklärung zur Schätzung mit den aktuellen Grundlagen
  function basisText(r) {
    var parts = [];
    if (r.delaySamples) parts.push('Verzug aus den letzten ' + r.delaySamples + ' aufgerufenen Spielen');
    var sl = function (k, label) {
      return label + ' ca. ' + Math.round(r.slot[k] / MIN) + ' min' +
        (r.slotSamples[k] ? ' (aus ' + r.slotSamples[k] + ' Spielen)' : ' (Erfahrungswert)');
    };
    parts.push('Courtbelegung je Spiel: ' + sl('s', 'Einzel') + ', ' + sl('d', 'Doppel'));
    parts.push(r.courts + ' Courts, Reihenfolge der Ansetzung, Pausen der Spieler zwischen zwei Spielen');
    if (r.testMode) parts.push('Testmodus: Datum der Ansetzungen wird ignoriert');
    return parts.join(' · ');
  }

  var api = { compute: compute, delayText: delayText, clock: clock, basisText: basisText, plannedMs: plannedMs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Schedule = api;
})(this);
