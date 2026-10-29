'use strict';

process.env.TZ = 'Europe/Berlin';
const test = require('node:test');
const assert = require('node:assert');
const Schedule = require('../public/schedule');

const MIN = 60000;
const at = (hm) => new Date(2026, 9, 29, +hm.split(':')[0], +hm.split(':')[1]).getTime();
const iso = (hm) => new Date(at(hm)).toISOString();
const day = '2026-10-29';

test('Zeitplan: Verzug aus den zuletzt aufgerufenen Spielen', () => {
  const st = {
    courts: [],
    upcoming: [],
    matches: [
      { id: 'a', status: 'finished', planned: { time: '10:00', date: day }, calledAt: iso('10:20') },
      { id: 'b', status: 'finished', planned: { time: '10:30', date: day }, calledAt: iso('10:55') },
      { id: 'c', status: 'live', planned: { time: '11:00', date: day }, calledAt: iso('11:30') },
    ],
  };
  const r = Schedule.compute(st, at('11:40'));
  assert.strictEqual(r.delay, 25 * MIN);
  assert.strictEqual(Schedule.delayText(r.delay), 'ca. 25 min Verzug');
  assert.strictEqual(Schedule.delayText(2 * MIN), 'im Zeitplan');
  assert.strictEqual(Schedule.delayText(-10 * MIN), 'ca. 10 min vor dem Zeitplan');
});

test('Zeitplan: nächste Spiele auf frei werdende Courts verteilen', () => {
  const st = {
    courts: [{ num: '1', match: 'live1' }, { num: '2', match: null }],
    matches: [
      { id: 'live1', status: 'live', home: ['A'], away: ['B'], doubles: false, calledAt: iso('11:30') },
    ],
    upcoming: [
      { id: 'u1', state: 'preparation', home: ['C'], away: ['D'], time: '11:00', date: day },
      { id: 'u2', state: 'scheduled', home: ['E'], away: ['F'], time: '11:00', date: day },
      { id: 'u3', state: 'scheduled', home: ['A'], away: ['G'], time: '11:00', date: day },
      { id: 'u4', state: 'scheduled', home: ['H'], away: ['I'], time: '18:00', date: day },
      { id: 'u5', state: 'scheduled', home: ['J'], away: ['K'], time: '10:00', date: '2026-10-30' },
    ],
  };
  const r = Schedule.compute(st, at('11:40'));
  assert.strictEqual(r.eta.u1, at('11:40'));                 // Court 2 frei
  assert.strictEqual(r.eta.u2, at('12:02'));                 // Court 1: 11:30 + 30 min + Wechsel
  assert.ok(r.eta.u3 >= at('12:00') + 5 * MIN);              // A spielt noch bis 12:00 + Pause
  assert.strictEqual(r.eta.u4, at('18:00'));                 // nicht vor der Ansetzung
  assert.strictEqual(r.eta.u5, undefined);                   // anderer Tag
  assert.strictEqual(Schedule.clock(at('12:02')), '12:00');
});

test('Zeitplan: ohne Erweiterung v2 keine Schätzung', () => {
  const r = Schedule.compute({ courts: [{ num: '1' }], matches: [], upcoming: null }, at('11:00'));
  assert.strictEqual(r.delay, null);
  assert.deepStrictEqual(r.eta, {});
});
