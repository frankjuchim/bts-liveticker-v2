// Scoreboard-Baustein für die Stream-Overlays (/court/<nr>, /courts)
(function () {
  'use strict';
  var el = BL.el;
  // Breiten (in em der Zeile) – passend zu .set und .points in overlay.css
  var SET_W = 1.87;
  var POINTS_W = 2.65;

  // Baut die Anzeige für einen Court. opts: { short, sets, linger }
  function courtBoard(state, courtNr, opts) {
    var court = BL.court(state, courtNr);
    var m = BL.courtMatch(state, court, opts.linger);

    var box = el('div', 'board');
    box.dataset.court = courtNr;

    if (!m) {
      box.classList.add('idle');
      var idle = el('div', 'board-idle');
      idle.appendChild(el('span', 'tag', 'Court ' + courtNr));
      idle.appendChild(el('span', null, court ? 'Kein laufendes Spiel' : 'Unbekannter Court'));
      box.appendChild(idle);
      return box;
    }

    var head = el('div', 'board-head');
    head.appendChild(el('span', 'tag', 'Court ' + courtNr));
    head.appendChild(el('span', 'disc', m.name));
    if (m.status === 'live') head.appendChild(el('span', 'state live', 'Live'));
    else if (m.status === 'called') head.appendChild(el('span', 'state called', 'Gleich'));
    else head.appendChild(el('span', 'state done', 'Beendet'));
    box.appendChild(head);

    var split = BL.splitSets(m);
    ['home', 'away'].forEach(function (side) {
      var row = el('div', 'row ' + side);
      if (m.winner === side) row.classList.add('winner');

      var team = el('div', 'team');
      var line = el('span', 'names');
      var names = BL.playerSpans(m, side, opts.short);
      if (!names.length) line.textContent = 'N. N.';
      names.forEach(function (n, i) {
        if (i) line.appendChild(document.createTextNode(' / '));
        line.appendChild(n);
      });
      team.appendChild(line);
      row.appendChild(team);

      // Fester Bereich für alle möglichen Sätze: laufender Satz ganz außen,
      // fertige Sätze rücken davor nach innen – die Box bleibt gleich breit.
      var slots = opts.sets === false ? 1 : m.bestOf || 3;
      var scores = el('div', 'scores');
      scores.style.width = ((slots - 1) * SET_W + POINTS_W) + 'em';
      if (opts.sets !== false) {
        split.done.forEach(function (s) {
          var c = el('span', 'set', String(s[side]));
          if (s.winner === side) c.classList.add('won');
          scores.appendChild(c);
        });
      }
      if (split.current) scores.appendChild(el('span', 'points', String(split.current[side])));
      row.appendChild(scores);
      box.appendChild(row);
    });

    return box;
  }

  // Optionen aus der URL, gleich für alle Overlays
  function options(p) {
    var linger = parseFloat(p.get('linger'));
    return {
      short: p.get('names') !== 'full',
      sets: p.get('sets') !== '0',
      linger: linger >= 0 ? linger : 5,
    };
  }

  window.Overlay = { courtBoard: courtBoard, options: options };
})();
