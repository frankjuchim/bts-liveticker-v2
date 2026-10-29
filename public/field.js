// Spielfeld-Ansicht (wie die Eingabeansicht in bup): Feld von oben, Spieler in
// ihren Aufschlagfeldern, Pfeil vom Aufschläger zum Rückschläger, Punktestand.
// Seiten: Heim beginnt links, Wechsel nach jedem Satz und im Entscheidungssatz
// (berechnet aus dem Spielstand, siehe homeLeft in lib/store.js).
(function () {
  'use strict';
  var el = BL.el;
  var NS = 'http://www.w3.org/2000/svg';
  var W = 1340;   // Feld 13,40 m × 6,10 m (in cm)
  var H = 610;

  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // Linien eines Badmintonfelds (Doppel- und Einzellinien)
  function court() {
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', class: 'f-lines' });
    var line = function (x1, y1, x2, y2) { svg('line', { x1: x1, y1: y1, x2: x2, y2: y2 }, s); };
    svg('rect', { x: 2, y: 2, width: W - 4, height: H - 4 }, s);
    line(0, 46, W, 46);            // Einzel-Seitenlinien
    line(0, H - 46, W, H - 46);
    line(76, 0, 76, H);            // hintere Aufschlaglinie Doppel
    line(W - 76, 0, W - 76, H);
    line(472, 0, 472, H);          // vordere Aufschlaglinie
    line(W - 472, 0, W - 472, H);
    line(0, H / 2, 472, H / 2);    // Mittellinien
    line(W - 472, H / 2, W, H / 2);
    svg('line', { x1: W / 2, y1: 0, x2: W / 2, y2: H, class: 'f-net' }, s);
    return s;
  }

  // Position eines Spielers in Feldkoordinaten.
  // Das links stehende Team schaut nach rechts: sein rechtes Feld ist unten.
  function spot(left, court, index, count) {
    var x = left ? 220 : W - 220;
    var y;
    if (court === 'R') y = left ? H * 0.75 : H * 0.25;
    else if (court === 'L') y = left ? H * 0.25 : H * 0.75;
    else if (count > 1) {
      // Position unbekannt: übereinander in der Mitte der Hälfte (auf der Mittellinie)
      return { x: x, y: index === 0 ? H / 2 - 42 : H / 2 + 42 };
    } else y = H / 2;
    return { x: x, y: y };
  }

  function onLeft(m, side) {
    var homeLeft = m.homeLeft !== false;
    return side === 'home' ? homeLeft : !homeLeft;
  }

  function current(m) {
    var split = BL.splitSets(m);
    return split.current || { home: 0, away: 0 };
  }

  // Animation nur einmal: Klasse danach entfernen, sonst startet sie neu,
  // sobald das Element wieder in die Seite eingehängt wird
  function once(node, cls) {
    node.classList.add(cls);
    node.addEventListener('animationend', function () { node.classList.remove(cls); }, { once: true });
  }

  // Schlüssel: ändert sich nur, wenn sich auf dem Feld etwas tut
  function key(m) {
    return JSON.stringify([m.status, m.sets, m.service, m.home, m.away, m.homeLeft]);
  }

  function build(m, opts, prev) {
    var card = el('article', 'field-card ' + m.status);
    var head = el('div', 'field-head');
    if (opts.court) {
      var cl = el(opts.link ? 'a' : 'span', 'court', 'Court ' + opts.court);
      if (opts.link) {
        cl.href = '/feld/' + encodeURIComponent(opts.court);
        cl.title = 'Spielfeld von Court ' + opts.court + ' groß anzeigen';
      }
      head.appendChild(cl);
    }
    head.appendChild(el('span', 'disc', m.name));
    if (m.status === 'live') head.appendChild(el('span', 'badge live', 'Live'));
    else if (m.status === 'called') head.appendChild(el('span', 'badge called', 'Aufruf'));
    else head.appendChild(el('span', 'badge done', 'Beendet'));
    card.appendChild(head);

    var f = el('div', 'field');
    f.appendChild(court());
    var sv = m.status === 'finished' ? null : m.service;
    var pos = sv && sv.positions;
    var spots = { home: [], away: [] };
    var labels = { home: [], away: [] };

    ['home', 'away'].forEach(function (side) {
      var list = m[side] || [];
      var places = pos && pos[side];
      list.forEach(function (name, i) {
        if (!name) return;
        var p = spot(onLeft(m, side), places ? places[i] : null, i, list.length);
        spots[side][i] = p;
        var lab = el('div', 'fp ' + side, opts.short ? BL.shortName(name) : name);
        lab.style.left = (p.x / W * 100) + '%';
        lab.style.top = (p.y / H * 100) + '%';
        if (sv && sv.server.side === side && sv.server.player === i) lab.classList.add('srv');
        // Aufschläger unbekannt (keine Positionen von BTS): aufschlagendes Team umrandet
        if (sv && sv.server.side === side && sv.server.player == null && list.length > 1) lab.classList.add('srv-team');
        if (sv && sv.receiver.side === side && sv.receiver.player === i && list.length > 1) lab.classList.add('rcv');
        if (m.winner === side) lab.classList.add('winner');
        labels[side][i] = lab;
        f.appendChild(lab);
      });
    });

    // Pfeil vom Aufschläger zum Rückschläger (Bogen wie der Flug des Balls)
    var from = sv && sv.server.player != null && spots[sv.server.side][sv.server.player];
    var to = sv && sv.receiver.player != null && spots[sv.receiver.side][sv.receiver.player];
    // Spieler unbekannt (BTS schickt keine Positionen): von Aufschlagfeld zu Aufschlagfeld
    var fields = false;
    if ((!from || !to) && sv && sv.serveCourt) {
      from = spot(onLeft(m, sv.server.side), sv.serveCourt);
      to = spot(onLeft(m, sv.receiver.side), sv.serveCourt);
      fields = true;
    }
    if (from && to) {
      var a = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', class: 'f-arrow' });
      var defs = svg('defs', {}, a);
      var mk = svg('marker', { id: 'ah-' + opts.uid, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
      svg('path', { d: 'M0,0 L10,5 L0,10 z' }, mk);
      var dir = from.x < to.x ? 1 : -1;
      // Start mitten unter dem Namen des Aufschlägers (der Pfeil liegt unter den Namen),
      // Ende kurz vor dem Namen des Rückschlägers – passend zur tatsächlichen Breite
      var x1 = from.x;
      var y1 = from.y;
      var y2 = to.y;
      var target = !fields && labels[sv.receiver.side][sv.receiver.player];
      var line = function (half) {
        var x2 = to.x - dir * (half + 14);
        return 'M' + x1 + ',' + y1 + ' Q' + (W / 2) + ',' + ((y1 + y2) / 2 - 170) + ' ' + x2 + ',' + y2;
      };
      var path = svg('path', {
        d: line(target ? 110 : 0),
        'marker-end': 'url(#ah-' + opts.uid + ')',
        'vector-effect': 'non-scaling-stroke',
      }, a);
      if (target) {
        // Breite erst nach dem Einfügen messbar (Feldkoordinaten: W Einheiten = Feldbreite)
        requestAnimationFrame(function () {
          if (!f.clientWidth || !target.offsetWidth) return;
          path.setAttribute('d', line(target.offsetWidth / 2 / f.clientWidth * W));
        });
      }
      // bei neuem Ballwechsel einzeichnen
      if (fields) svg('circle', { cx: x1, cy: y1, r: 14, class: 'f-shuttle' }, a);
      if (!prev || prev.arrowKey !== JSON.stringify(sv)) once(path, 'draw');
      f.insertBefore(a, f.querySelector('.fp'));   // unter den Namen
    }

    // Punktestand am Netz
    var cur = current(m);
    var showPts = m.status === 'live';
    ['home', 'away'].forEach(function (side) {
      var sc = el('div', 'fscore ' + (onLeft(m, side) ? 'left' : 'right'), showPts ? String(cur[side]) : '');
      if (showPts && prev && prev.cur && prev.cur[side] !== cur[side]) once(sc, 'bump');
      f.appendChild(sc);
    });
    card.appendChild(f);

    // Sätze
    var foot = el('div', 'field-foot');
    var done = BL.splitSets(m).done;
    if (done.length) foot.appendChild(el('span', 'f-sets', 'Sätze ' + done.map(function (s) { return s.home + ':' + s.away; }).join('  ')));
    if (m.status === 'finished') foot.appendChild(el('span', 'f-result', m.setsWon[0] + ':' + m.setsWon[1]));
    if (!sv && m.status === 'live') foot.appendChild(el('span', 'muted', 'Aufschlag unbekannt'));
    card.appendChild(foot);
    return { el: card, key: key(m), arrowKey: JSON.stringify(sv), cur: showPts ? cur : null };
  }

  // Liefert das Spielfeld für ein Spiel; unverändert → dasselbe Element (keine Animation)
  var cache = {};
  function render(m, opts) {
    opts = opts || {};
    var id = (opts.court || '') + '|' + m.id;
    opts.uid = String(opts.court || m.id).replace(/[^\w-]/g, '');
    var prev = cache[id];
    if (prev && prev.key === key(m)) return prev.el;
    var next = build(m, opts, prev);
    cache[id] = next;
    return next.el;
  }

  // Leeres Spielfeld (freier Court) mit Text in der Mitte
  function empty(courtNum, text) {
    var card = el('article', 'field-card idle');
    var head = el('div', 'field-head');
    head.appendChild(el('span', 'court', 'Court ' + courtNum));
    card.appendChild(head);
    var f = el('div', 'field');
    f.appendChild(court());
    f.appendChild(el('div', 'f-idle', text || 'frei'));
    card.appendChild(f);
    card.appendChild(el('div', 'field-foot'));
    return card;
  }

  window.Field = { render: render, empty: empty };
})();
