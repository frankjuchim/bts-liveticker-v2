'use strict';

const test = require('node:test');
const assert = require('node:assert');
const branding = require('../lib/branding');

test('Standard: neutrales Blau, Federball-Symbol', () => {
  const b = branding.load({}, '/gibt-es-nicht');
  assert.strictEqual(b.title, 'Badminton');
  assert.strictEqual(b.logoUrl, '/shuttle.svg');
  assert.match(b.css, /--club: #1f5f99;/);
  assert.match(b.css, /--panel: rgba\(31, 95, 153, 0.94\);/);
});

test('Eigene Farbe und Titel, HTML wird maskiert', () => {
  const b = branding.load({ ACCENT: '#960000', TITLE: 'TV <Test>' }, '/gibt-es-nicht');
  assert.match(b.css, /--club: #960000;/);
  assert.match(b.css, /--club-dark: #690000;/);
  assert.strictEqual(branding.render('<b>{{TITLE}}</b>', b), '<b>TV &lt;Test&gt;</b>');
});

test('Ungültige Farbe fällt auf Standard zurück', () => {
  const b = branding.load({ ACCENT: 'rot' }, '/gibt-es-nicht');
  assert.match(b.css, /--club: #1f5f99;/);
});
