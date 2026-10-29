// Spielern folgen: Liste im Browser (localStorage), Hervorhebung, Hinweise bei
// Aufruf/Spielende (auf der Seite und – wenn erlaubt – als Browser-Benachrichtigung).
// Dazu kleine Helfer für Vereine und Spieldauer.
(function () {
  'use strict';
  var el = BL.el;
  var KEY = 'follow';
  var CLUB_KEY = 'followClubs';
  var listeners = [];

  function load(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x; }) : [];
    } catch (e) { return []; }
  }
  var seen = null;   // Spiel-ID → letzter Zustand (erster Stand löst nichts aus)
  var list = load(KEY);
  var clubList = load(CLUB_KEY);

  function save() {
    // neuer Ausgangsstand: Folgen selbst löst keine Hinweise aus
    seen = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      localStorage.setItem(CLUB_KEY, JSON.stringify(clubList));
    } catch (e) { /* egal */ }
    listeners.forEach(function (fn) { fn(list.slice()); });
  }

  // Auch in anderen Tabs geänderte Listen übernehmen
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY && e.key !== CLUB_KEY) return;
    list = load(KEY);
    clubList = load(CLUB_KEY);
    listeners.forEach(function (fn) { fn(list.slice()); });
  });

  var norm = function (n) { return String(n || '').trim().toLowerCase(); };
  function has(name) { var n = norm(name); return list.some(function (x) { return norm(x) === n; }); }
  function toggle(name) {
    if (!name) return;
    if (has(name)) list = list.filter(function (x) { return norm(x) !== norm(name); });
    else list.push(name);
    save();
  }
  function remove(name) { list = list.filter(function (x) { return norm(x) !== norm(name); }); save(); }

  // Vereinen folgen (alle Spieler eines Vereins)
  function hasClub(club) { var n = norm(club); return Boolean(n) && clubList.some(function (x) { return norm(x) === n; }); }
  function toggleClub(club) {
    if (!club) return;
    if (hasClub(club)) clubList = clubList.filter(function (x) { return norm(x) !== norm(club); });
    else clubList.push(club);
    save();
  }

  // Spiel mit mindestens einem gefolgten Spieler bzw. Verein?
  function involves(m) {
    if (!m || (!list.length && !clubList.length)) return false;
    if ((m.home || []).concat(m.away || []).some(has)) return true;
    return (m.homeClubs || []).concat(m.awayClubs || []).some(hasClub);
  }

  // Name als antippbares Element: Tippen = folgen / nicht mehr folgen
  function nameEl(tag, cls, name, text) {
    var e = el(tag, (cls ? cls + ' ' : '') + 'pname' + (has(name) ? ' fav' : ''), text || name);
    e.dataset.name = name;
    e.title = has(name) ? 'Nicht mehr folgen' : 'Diesem Spieler folgen';
    return e;
  }

  // Vereine einer Seite, doppelte nur einmal: „TV Metjendorf“ bzw. „TV A / BC B“
  function clubs(m, side) {
    var c = (side === 'home' ? m.homeClubs : m.awayClubs) || [];
    var out = [];
    c.forEach(function (x) { if (x && out.indexOf(x) < 0) out.push(x); });
    return out.join(' / ');
  }

  // 1860000 → „31 min“, 3900000 → „1:05 h“
  function duration(ms) {
    if (!ms || ms < 0) return '';
    var min = Math.round(ms / 60000);
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0') + ' h';
  }

  // ---- Hinweise bei Aufruf / Spielende gefolgter Spieler

  function notifyAllowed() {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  function toast(title, body) {
    var box = document.getElementById('toasts');
    if (!box) {
      box = el('div', 'toasts');
      box.id = 'toasts';
      document.body.appendChild(box);
    }
    var t = el('div', 'toast');
    t.appendChild(el('b', null, title));
    t.appendChild(el('span', null, body));
    t.addEventListener('click', function () { t.remove(); });
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 9000);
    setTimeout(function () { t.remove(); }, 9600);
    if (notifyAllowed() && document.hidden) {
      try { new Notification(title, { body: body, tag: title + body }); } catch (e) { /* manche Browser nur per Service Worker */ }
    }
  }

  function vs(m) {
    return (m.home || []).filter(Boolean).join(' / ') + ' – ' + (m.away || []).filter(Boolean).join(' / ');
  }

  function check(state) {
    if (!state) return;
    var now = {};
    (state.matches || []).forEach(function (m) { if (involves(m)) now[m.id] = { s: m.status, m: m }; });
    (state.upcoming || []).forEach(function (u) { if (involves(u) && !now[u.id]) now[u.id] = { s: u.state, m: u }; });
    if (seen) {
      Object.keys(now).forEach(function (id) {
        var cur = now[id];
        var before = seen[id];
        var m = cur.m;
        if ((cur.s === 'called' || cur.s === 'live') && (!before || (before !== 'called' && before !== 'live'))) {
          toast('Court ' + (m.court || '?') + ': ' + m.name, vs(m));
        } else if (cur.s === 'finished' && before && before !== 'finished') {
          var w = m.winner === 'home' ? m.home : m.away;
          toast('Beendet: ' + m.name, (w || []).filter(Boolean).join(' / ') + ' gewinnt ' +
            Math.max(m.setsWon[0], m.setsWon[1]) + ':' + Math.min(m.setsWon[0], m.setsWon[1]) +
            ' (' + m.sets.map(function (s) {
              return m.winner === 'away' ? s.away + ':' + s.home : s.home + ':' + s.away;   // aus Sicht des Siegers
            }).join(', ') + ')');
        } else if (cur.s === 'preparation' && before !== 'preparation') {
          toast('Gleich dran: ' + m.name, vs(m) + (m.time ? ' · geplant ' + m.time + ' Uhr' : ''));
        }
      });
    }
    seen = {};
    Object.keys(now).forEach(function (id) { seen[id] = now[id].s; });
  }

  function askNotify(cb) {
    if (!('Notification' in window)) return cb('unsupported');
    Notification.requestPermission().then(cb, function () { cb('denied'); });
  }

  // Tippen auf einen Namen (überall auf der Seite) folgt dem Spieler
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.pname');
    if (!t) return;
    e.preventDefault();
    toggle(t.dataset.name);
  });

  window.Follow = {
    list: function () { return list.slice(); },
    clubs: function () { return clubList.slice(); },
    hasClub: hasClub,
    toggleClub: toggleClub,
    has: has,
    toggle: toggle,
    remove: remove,
    involves: involves,
    nameEl: nameEl,
    clubLine: clubs,
    duration: duration,
    check: check,
    notifyAllowed: notifyAllowed,
    askNotify: askNotify,
    onChange: function (fn) { listeners.push(fn); },
  };
})();
