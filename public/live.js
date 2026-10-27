// Gemeinsame Client-Logik: Verbindung zum Server (SSE mit Polling-Fallback)
// und kleine Hilfsfunktionen für alle Seiten.
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);

  // onState(state) wird bei jedem neuen Stand aufgerufen. Der Server schickt
  // nach einem kompletten Stand nur noch geänderte Spiele – die werden hier
  // in den Stand eingearbeitet.
  function connect(onState) {
    var state = null;

    function poll() {
      fetch('/api/state', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (s) { state = s; onState(s); })
        .catch(function () {})
        .finally(function () { setTimeout(poll, 3000); });
    }

    if (!window.EventSource) return poll();

    var es = new EventSource('/api/events');
    es.addEventListener('state', function (e) {
      state = JSON.parse(e.data);
      onState(state);
    });
    es.addEventListener('matches', function (e) {
      if (!state) return;
      var d = JSON.parse(e.data);
      d.matches.forEach(function (m) {
        var i = indexOf(state.matches, m.id);
        if (i >= 0) state.matches[i] = m;
        else state.matches.push(m);
      });
      state.updatedAt = d.updatedAt;
      state.bts = d.bts;
      onState(state);
    });
  }

  function indexOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  function match(state, id) {
    if (!state || !id) return null;
    var i = indexOf(state.matches, id);
    return i >= 0 ? state.matches[i] : null;
  }

  function court(state, nr) {
    var list = (state && state.courts) || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].num) === String(nr)) return list[i];
    return null;
  }

  // Was auf einem Court angezeigt werden soll: das Spiel, das dort liegt –
  // oder (für linger Minuten) das zuletzt dort beendete Spiel.
  function courtMatch(state, c, lingerMin) {
    if (!c) return null;
    var m = match(state, c.match);
    if (m) return m;
    var last = match(state, c.last);
    if (!last || !last.finishedAt) return null;
    var age = (Date.now() - new Date(last.finishedAt).getTime()) / 60000;
    return age <= lingerMin ? last : null;
  }

  // Abgeschlossene Sätze und laufender Satz eines Spiels
  function splitSets(m) {
    var sets = m.sets.slice();
    var current = null;
    if (m.status === 'live' && sets.length && !sets[sets.length - 1].winner) current = sets.pop();
    if (m.status === 'live' && !current) current = { home: 0, away: 0 };
    return { done: sets, current: current };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // „Max Mustermann“ → „M. Mustermann“
  function shortName(n) {
    if (!n) return n;
    var parts = n.split(/\s+/);
    if (parts.length < 2) return n;
    var last = parts.pop();
    return parts.map(function (p) { return p.charAt(0) + '.'; }).join(' ') + ' ' + last;
  }

  function players(list, short) {
    return (list || [])
      .map(function (n) { return n ? (short ? shortName(n) : n) : null; })
      .filter(Boolean);
  }

  // Namen einer Seite als <span>s: Aufschläger mit Punkt (.srv), im Doppel
  // Rückschläger unterstrichen (.rcv). Leere Plätze bleiben ausgelassen.
  function playerSpans(m, side, short) {
    var sv = m.service;
    var list = [];
    (m[side] || []).forEach(function (n, i) {
      if (!n) return;
      var span = el('span', 'name', short ? shortName(n) : n);
      if (sv && sv.server.side === side && sv.server.player === i) {
        span.classList.add('srv');
      }
      if (sv && sv.receiver.side === side && m[side].length > 1 && sv.receiver.player === i) {
        span.classList.add('rcv');
      }
      list.push(span);
    });
    return list;
  }

  function time(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  function hex(v) {
    return /^[0-9a-f]{3,8}$/i.test(v) ? '#' + v : v;
  }

  function applyCommonParams() {
    var root = document.documentElement.style;
    var scale = parseFloat(params.get('scale'));
    if (scale > 0) root.setProperty('--scale', String(scale));
    var bg = params.get('bg');
    if (bg) document.body.style.setProperty('background', hex(bg), 'important');
  }

  window.BL = {
    params: params,
    connect: connect,
    match: match,
    court: court,
    courtMatch: courtMatch,
    splitSets: splitSets,
    el: el,
    shortName: shortName,
    players: players,
    playerSpans: playerSpans,
    time: time,
    applyCommonParams: applyCommonParams,
  };
})();
