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

test('Einstellungen aus dem Admin-Panel gehen vor, leere Felder nicht', () => {
  const s = branding.cleanSettings({ title: '  BC Test ', subtitle: '', accent: '0A7D3B', foo: 'x' });
  assert.deepStrictEqual(s, { title: 'BC Test', accent: '#0a7d3b' });
  const b = branding.load({ TITLE: 'Aus Datei', SUBTITLE: 'Unter' }, '/gibt-es-nicht', s);
  assert.strictEqual(b.title, 'BC Test');
  assert.strictEqual(b.subtitle, 'Unter');
  assert.strictEqual(b.accent, '#0a7d3b');
});

test('Ungültige Einstellungen werden abgelehnt', () => {
  assert.throws(() => branding.cleanSettings({ accent: 'rot' }));
  assert.throws(() => branding.cleanSettings({ title: 'x'.repeat(81) }));
});

test('Alle Farbvorschläge sind mit weißer Schrift gut lesbar', () => {
  for (const p of branding.PRESETS) {
    assert.ok(branding.contrastWithWhite(branding.parseHex(p.color)) >= 4.5, p.name);
  }
});
