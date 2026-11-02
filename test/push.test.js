'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const pushLib = require('../lib/push');

test('Push: Ereignisse aus zwei Ständen', () => {
  const m = (id, status, extra) => Object.assign({ id, name: 'HE R16', status, home: ['A'], away: ['B'], homeClubs: ['TV X'], awayClubs: [], court: '3', sets: [], setsWon: [0, 0] }, extra);
  assert.deepStrictEqual(pushLib.events(null, { matches: [m('1', 'live')] }), []);   // erster Stand: nichts
  const prev = { matches: [{ id: '1', status: 'called' }, { id: '2', status: 'live' }], upcoming: [{ id: '3', state: 'scheduled' }, { id: '4', state: 'scheduled' }] };
  const ev = pushLib.events(prev, {
    matches: [m('1', 'live'), m('2', 'finished', { winner: 'away', sets: [{ home: 10, away: 21 }, { home: 15, away: 21 }], setsWon: [0, 2] }), m('4', 'called')],
    upcoming: [{ id: '3', name: 'DE VF', state: 'preparation', home: ['C'], away: ['D'], homeClubs: [], awayClubs: [] }],
  });
  assert.deepStrictEqual(ev.map((e) => e.title), ['Beendet: HE R16', 'Court 3: HE R16', 'Gleich dran: DE VF']);
  assert.strictEqual(ev[0].body, 'B gewinnt 2:0 (21:10, 21:15)');
  assert.deepStrictEqual(ev[1].clubs, ['TV X']);
});

test('Push: nur Abos der Browser-Push-Dienste', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
  const p = pushLib.create(dir);
  assert.ok(p.publicKey());
  const keys = { p256dh: 'x', auth: 'y' };
  assert.throws(() => p.subscribe({ subscription: { endpoint: 'https://evil.example/x', keys } }));
  assert.throws(() => p.subscribe({ subscription: { endpoint: 'http://fcm.googleapis.com/x', keys } }));
  p.subscribe({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }, players: ['A'], clubs: [] });
  p.subscribe({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }, players: ['A', 'B'] });
  assert.strictEqual(p.count(), 1);
  p.unsubscribe('https://fcm.googleapis.com/fcm/send/abc');
  assert.strictEqual(p.count(), 0);
  // Schlüssel bleiben gleich
  assert.strictEqual(pushLib.create(dir).publicKey(), p.publicKey());
});
