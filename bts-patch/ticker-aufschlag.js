'use strict';

// Erweitert bts/ticker_conn.js von BTS für den Liveticker (bts-liveticker-v2), Version 3.
// Funktioniert mit älteren und neueren BTS-Versionen, weil nur an festen
// Ankerstellen eingefügt wird:
//   node ticker-aufschlag.js bts/ticker_conn.js
//
// Zusätzlich gesendet:
//   ts  = Team 1 schlägt auf (network_team1_serving)          tset + tupdate_match
//   pe  = je Team: steht Spieler 1 im rechten Feld             tset + tupdate_match
//   d   = Doppel (setup.is_doubles)                            tset
//   c0/c1 = Verein (sonst Nation) je Spieler                   tset
//   dur = Spieldauer in ms (aus bup)                           tset + tupdate_match
//   upcoming = die nächsten Spiele (in Vorbereitung / geplant)  tset
//   di  = Feld (draw_id) je Spiel                              tset
//   draws = alle Spiele aller Felder mit Verknüpfungen         tset
//           (für die Turnierbäume), xv = Version der Erweiterung
//
// Die Datei muss im Originalzustand sein; apply.sh stellt sie bei einem Upgrade
// von einer älteren Version der Erweiterung vorher wieder her.

const fs = require('fs');

const VERSION = 3;
const MARKER = 'bts-liveticker-erweiterung v' + VERSION;
const file = process.argv[2] || 'bts/ticker_conn.js';
let src = fs.readFileSync(file, 'utf8');

if (src.includes(MARKER)) {
  console.log('bereits erweitert (v' + VERSION + ')');
  process.exit(0);
}
if (src.includes('craft_service')) {
  console.error('Ältere Version der Erweiterung gefunden – bitte zuerst die Originaldatei wiederherstellen (apply.sh macht das).');
  process.exit(3);
}

function once(re, replace, what) {
  const all = src.match(new RegExp(re.source, re.flags.replace('g', '') + 'g'));
  if (!all || all.length !== 1) {
    console.error(`Ankerstelle nicht eindeutig gefunden: ${what}`);
    process.exit(2);
  }
  src = src.replace(re, replace);
}

const HELPERS = [
  '// ' + MARKER + ' – zusätzliche Daten für den Liveticker:',
  '// Aufschlag/Positionen, Doppel, Vereine, Spieldauer und die nächsten Spiele',
  'function craft_service(m) {',
  '\treturn {',
  "\t\tts: (typeof m.network_team1_serving === 'boolean') ? m.network_team1_serving : null,",
  '\t\tpe: Array.isArray(m.network_teams_player1_even) ? m.network_teams_player1_even : null,',
  "\t\tdur: (typeof m.duration_ms === 'number') ? m.duration_ms : null,",
  '\t};',
  '}',
  '',
  'function craft_liveticker(m) {',
  '\tconst res = craft_service(m);',
  "\tif (typeof m.setup.is_doubles === 'boolean') res.d = m.setup.is_doubles;",
  "\tif (m.setup.draw_id != null) res.di = String(m.setup.draw_id);",
  '\t(m.setup.teams || []).forEach((t, tidx) => {',
  "\t\tres['c' + tidx] = (t.players || []).map(p => (p && (p.club || p.nationality)) || '');",
  '\t});',
  '\treturn res;',
  '}',
  '',
  '// Die nächsten Spiele (in Vorbereitung zuerst, dann nach geplanter Zeit) und',
  '// alle Spiele aller Felder für die Turnierbäume – aus einer Abfrage',
  'function liveticker_extra(app, tournament_key, cb) {',
  '\tapp.db.matches.find({ tournament_key }, (err, matches) => {',
  '\t\tif (err || !Array.isArray(matches)) return cb(undefined, undefined);',
  '\t\tconst names = t => ((t && t.players) || []).map(p => (p && p.name) || \'\');',
  "\t\tconst clubs = t => ((t && t.players) || []).map(p => (p && (p.club || p.nationality)) || '');",
  '\t\tconst open = matches.filter(m => {',
  '\t\t\tconst s = m.setup || {};',
  "\t\t\tif (s.now_on_court || m.end_ts || typeof m.team1_won === 'boolean') return false;",
  "\t\t\tif (!(s.teams || []).every(t => t && t.players && t.players.length)) return false;",
  "\t\t\treturn s.state === 'preparation' || s.state === 'scheduled' || (!s.state && s.scheduled_time_str);",
  '\t\t});',
  "\t\tconst key = m => [m.setup.state === 'preparation' ? 0 : 1, m.setup.scheduled_date || '9', m.setup.scheduled_time_str || '99:99', String(m.setup.match_num || '').padStart(6, '0')].join('|');",
  '\t\topen.sort((a, b) => (key(a) < key(b) ? -1 : (key(a) > key(b) ? 1 : 0)));',
  '\t\tconst upcoming = open.slice(0, 60).map(m => {',
  "\t\t\tconst res = { _id: m._id, n: m.setup.event_name + ' ' + m.setup.match_name };",
  '\t\t\tm.setup.teams.forEach((t, tidx) => {',
  "\t\t\t\tres['p' + tidx] = names(t);",
  "\t\t\t\tres['c' + tidx] = clubs(t);",
  '\t\t\t});',
  '\t\t\tres.t = m.setup.scheduled_time_str || null;',
  '\t\t\tres.dt = m.setup.scheduled_date || null;',
  '\t\t\tres.st = m.setup.state || null;',
  '\t\t\tres.mn = m.setup.match_num || null;',
  '\t\t\tif (m.setup.draw_id != null) res.di = String(m.setup.draw_id);',
  '\t\t\treturn res;',
  '\t\t});',
  '\t\tconst draws = matches.filter(m => m.setup && m.setup.draw_id != null).map(m => {',
  '\t\t\tconst s = m.setup;',
  '\t\t\tconst l = s.links || {};',
  "\t\t\tconst ids = (m.btp_match_ids && m.btp_match_ids[0]) || {};",
  '\t\t\tconst res = {',
  "\t\t\t\t_id: m._id, di: String(s.draw_id), dn: s.draw_name || '', en: s.event_name || '',",
  "\t\t\t\tsn: s.stage_name || '', so: s.stage_display_order, dp: s.draw_position,",
  "\t\t\t\tr: s.match_name || '', ph: s.phase_name_raw || '', mn: s.match_num || null,",
  '\t\t\t\tpl: ids.planning != null ? ids.planning : null,',
  '\t\t\t\tf1: l.from1 != null ? l.from1 : null, f2: l.from2 != null ? l.from2 : null,',
  '\t\t\t\twt: l.winner_to != null ? l.winner_to : null, lt: l.loser_to != null ? l.loser_to : null,',
  '\t\t\t\tp0: names((s.teams || [])[0]), p1: names((s.teams || [])[1]),',
  '\t\t\t\tc0: clubs((s.teams || [])[0]), c1: clubs((s.teams || [])[1]),',
  "\t\t\t\ts: m.network_score || null, w: typeof m.team1_won === 'boolean' ? m.team1_won : null,",
  "\t\t\t\tst: s.state || null, t: s.scheduled_time_str || null, dt: s.scheduled_date || null,",
  '\t\t\t};',
  '\t\t\tif (Array.isArray(s.btp_group_rankings)) {',
  '\t\t\t\tres.rk = s.btp_group_rankings.map(r => ({ p: r.place_from, n: names(r.team), c: clubs(r.team) }));',
  '\t\t\t}',
  '\t\t\treturn res;',
  '\t\t});',
  '\t\tcb(upcoming, draws);',
  '\t});',
  '}',
  '',
].join('\n');

once(/^function craft_match\(m\) \{/m, HELPERS + 'function craft_match(m) {', 'function craft_match');

once(/^([ \t]*)res\.s = m\.network_score;(\r?\n)/m, (all, ind, nl) => [
  `${ind}res.s = m.network_score;`,
  `${ind}Object.assign(res, craft_liveticker(m));`,
].join(nl) + nl, 'res.s = m.network_score (craft_match)');

once(/^([ \t]*)s: match\.network_score,(\r?\n)/m, (all, ind, nl) => [
  `${ind}s: match.network_score,`,
  `${ind}...craft_service(match),`,
].join(nl) + nl, 's: match.network_score (update_score)');

// tset: die nächsten Spiele mitschicken
once(/^([ \t]*)this\.sendmsg\(\{(\r?\n)[ \t]*type: 'tset',\r?\n[ \t]*event,\r?\n[ \t]*\}\);/m, (all, ind, nl) => [
  `${ind}liveticker_extra(this.app, this.tournament_key, (upcoming, draws) => {`,
  `${ind}\tevent.xv = ${VERSION};`,
  `${ind}\tif (upcoming) event.upcoming = upcoming;`,
  `${ind}\tif (draws) event.draws = draws;`,
  `${ind}\tthis.sendmsg({`,
  `${ind}\t\ttype: 'tset',`,
  `${ind}\t\tevent,`,
  `${ind}\t});`,
  `${ind}});`,
].join(nl), 'sendmsg tset (pushall)');

fs.writeFileSync(file, src);
console.log('erweitert (v' + VERSION + '): ' + file);
