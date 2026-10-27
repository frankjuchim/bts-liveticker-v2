'use strict';

// Erscheinungsbild aus der Konfiguration (Umgebungsvariablen):
//   TITLE      Überschrift im Kopf, z. B. Vereinsname     (Standard „Badminton“)
//   SUBTITLE   Zeile darunter                             (Standard „Turnier-Liveticker“)
//   ACCENT     Akzentfarbe als Hex, z. B. #960000         (Standard neutrales Blau)
//   LOGO_FILE  Pfad zu einem eigenen Logo (PNG/SVG/JPG/WebP). Ohne Angabe wird
//              <DATA_DIR>/logo.(png|svg|jpg|webp) genommen, sonst ein Federball-Symbol.
// Titel, Untertitel und Farbe lassen sich zusätzlich im Admin-Panel ändern
// (gespeichert in <DATA_DIR>/settings.json) – diese Werte haben Vorrang.

const fs = require('fs');
const path = require('path');

const DEFAULT_ACCENT = '#1f5f99';

// Farbvorschläge im Admin-Panel (alle mit gut lesbarer weißer Schrift)
const PRESETS = [
  { name: 'Blau', color: '#1f5f99' },
  { name: 'Dunkelblau', color: '#1b2f5b' },
  { name: 'Petrol', color: '#00707a' },
  { name: 'Grün', color: '#0a7d3b' },
  { name: 'Rot', color: '#b00020' },
  { name: 'Weinrot', color: '#960000' },
  { name: 'Orange', color: '#b84d00' },
  { name: 'Violett', color: '#5b2a86' },
  { name: 'Anthrazit', color: '#3a3f47' },
  { name: 'Schwarz', color: '#16191d' },
];

function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// a nach b mischen (t = Anteil von b)
function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

function findLogo(dataDir, logoFile) {
  if (logoFile) return fs.existsSync(logoFile) ? logoFile : null;
  for (const ext of ['png', 'svg', 'jpg', 'jpeg', 'webp']) {
    const f = path.join(dataDir, 'logo.' + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// Kontrast zu weißer Schrift (WCAG); unter 3 wird Text auf der Farbe schwer lesbar
function contrastWithWhite(c) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  return 1.05 / (L + 0.05);
}

// Einstellungen aus dem Admin-Panel prüfen; wirft bei ungültigen Werten
function cleanSettings(input) {
  const out = {};
  for (const key of ['title', 'subtitle']) {
    if (input[key] == null) continue;
    const v = String(input[key]).trim();
    if (v.length > 80) throw new Error(`${key} ist zu lang (max. 80 Zeichen)`);
    if (v) out[key] = v;
  }
  if (input.accent != null && String(input.accent).trim()) {
    const c = parseHex(input.accent);
    if (!c) throw new Error('Farbe muss eine Hex-Farbe sein, z. B. #1f5f99');
    out.accent = hex(c);
  }
  return out;
}

function load(env, dataDir, overrides) {
  overrides = overrides || {};
  const accentRaw = overrides.accent || env.ACCENT || DEFAULT_ACCENT;
  let accent = parseHex(accentRaw);
  if (!accent) {
    console.warn(`ACCENT „${accentRaw}“ ist keine Hex-Farbe – nehme ${DEFAULT_ACCENT}`);
    accent = parseHex(DEFAULT_ACCENT);
  }
  const dark = mix(accent, [0, 0, 0], 0.3);
  const white = [255, 255, 255];
  const night = [15, 20, 27];

  const css = `/* aus der Konfiguration erzeugt (ACCENT) */
:root {
  --club: ${hex(accent)};
  --club-dark: ${hex(dark)};
  --live: ${hex(accent)};
  --win-bg: ${hex(mix(accent, white, 0.88))};
  --link: ${hex(accent)};
  --panel: ${rgba(accent, 0.94)};
  --panel-2: ${rgba(dark, 0.97)};
}
@media (prefers-color-scheme: dark) {
  :root {
    --live: ${hex(mix(accent, white, 0.15))};
    --win-bg: ${hex(mix(night, accent, 0.3))};
    --link: ${hex(mix(accent, white, 0.5))};
  }
}
`;

  const logo = findLogo(dataDir, env.LOGO_FILE);
  return {
    title: overrides.title || env.TITLE || 'Badminton',
    subtitle: overrides.subtitle || env.SUBTITLE || 'Turnier-Liveticker',
    accent: hex(accent),
    css,
    logoFile: logo,
    logoUrl: logo ? '/brand-logo' + path.extname(logo) : '/shuttle.svg',
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Platzhalter in den HTML-Seiten ersetzen
function render(html, b) {
  return html
    .split('{{TITLE}}').join(escapeHtml(b.title))
    .split('{{SUBTITLE}}').join(escapeHtml(b.subtitle))
    .split('{{LOGO}}').join(escapeHtml(b.logoUrl));
}

module.exports = { load, render, cleanSettings, contrastWithWhite, parseHex, mix, PRESETS, DEFAULT_ACCENT };
