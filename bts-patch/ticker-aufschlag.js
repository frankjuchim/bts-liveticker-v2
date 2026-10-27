'use strict';

// Erweitert bts/ticker_conn.js von BTS, damit der Liveticker Aufschläger und
// Rückschläger anzeigen kann. Funktioniert mit älteren und neueren BTS-Versionen,
// weil nur an festen Ankerstellen eingefügt wird:
//   node ticker-aufschlag.js bts/ticker_conn.js
//
// Zusätzlich gesendet (tset und tupdate_match):
//   ts = Team 1 schlägt auf (network_team1_serving)
//   pe = je Team: steht Spieler 1 im rechten/geraden Feld (network_teams_player1_even)
//   d  = Doppel (setup.is_doubles, nur tset)

const fs = require('fs');

const file = process.argv[2] || 'bts/ticker_conn.js';
let src = fs.readFileSync(file, 'utf8');

if (src.includes('craft_service')) {
  console.log('bereits erweitert');
  process.exit(0);
}

function once(re, replace, what) {
  const all = src.match(new RegExp(re.source, re.flags.replace('g', '') + 'g'));
  if (!all || all.length !== 1) {
    console.error(`Ankerstelle nicht eindeutig gefunden: ${what}`);
    process.exit(2);
  }
  src = src.replace(re, replace);
}

once(/^function craft_match\(m\) \{/m, [
  '// Aufschlag und Positionen für den Liveticker (Aufschläger/Rückschläger):',
  '// ts = Team 1 schlägt auf, pe = je Team: steht Spieler 1 im rechten (geraden) Feld',
  'function craft_service(m) {',
  '\treturn {',
  "\t\tts: (typeof m.network_team1_serving === 'boolean') ? m.network_team1_serving : null,",
  '\t\tpe: Array.isArray(m.network_teams_player1_even) ? m.network_teams_player1_even : null,',
  '\t};',
  '}',
  '',
  'function craft_match(m) {',
].join('\n'), 'function craft_match');

once(/^([ \t]*)res\.s = m\.network_score;(\r?\n)/m, (all, ind, nl) => [
  `${ind}res.s = m.network_score;`,
  `${ind}Object.assign(res, craft_service(m));`,
  `${ind}if (typeof m.setup.is_doubles === 'boolean') res.d = m.setup.is_doubles;`,
].join(nl) + nl, 'res.s = m.network_score (craft_match)');

once(/^([ \t]*)s: match\.network_score,(\r?\n)/m, (all, ind, nl) => [
  `${ind}s: match.network_score,`,
  `${ind}...craft_service(match),`,
].join(nl) + nl, 's: match.network_score (update_score)');

fs.writeFileSync(file, src);
console.log('erweitert: ' + file);
