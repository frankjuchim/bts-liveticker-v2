'use strict';

// Update aus dem Admin-Panel (nur bei Installation per deploy/install.sh, z. B. im
// Proxmox-Container). Der Liveticker läuft ohne root-Rechte und kann sich nicht
// selbst aktualisieren. Er legt deshalb nur die Datei update.request im
// Datenverzeichnis an; die systemd-Einheit bts-liveticker-update.path bemerkt sie
// und startet als root deploy/update.sh (Code von GitHub holen, Dienst neu starten).
//
// Im Docker-Container (docker-compose.yml) übernimmt Watchtower das: Der Ticker ruft
// dessen HTTP-API (UPDATE_URL, UPDATE_TOKEN) auf, Watchtower holt das neue Image und
// startet den Ticker-Container neu. Der Ticker selbst bekommt keinen Zugriff auf Docker.
//
// Installierte Version: .version.json im Programmverzeichnis (schreibt install.sh bzw.
// der Docker-Build).
// Neueste Version: GitHub-API des Repositorys (nur auf Anfrage, 10 min gemerkt).

const fs = require('fs');
const path = require('path');
const https = require('https');

const http = require('http');

const PATH_UNIT = '/etc/systemd/system/bts-liveticker-update.path';
const UPDATE_URL = process.env.UPDATE_URL || '';
const UPDATE_TOKEN = process.env.UPDATE_TOKEN || '';
const CACHE_MS = 10 * 60 * 1000;

function create(appDir, dataDir) {
  const versionFile = path.join(appDir, '.version.json');
  const requestFile = path.join(dataDir, 'update.request');
  const logFile = path.join(dataDir, 'update.log');
  let cache = null;   // { at, key, data }

  // Nach dem Neustart durch Watchtower: angefangenes Update abschließen
  try {
    const l = fs.readFileSync(logFile, 'utf8');
    const m = /^UPDATE_STARTED \S+ von (\S+)/m.exec(l);
    if (m && !/^UPDATE_RESULT=/m.test(l)) {
      const now = installed();
      const ok = now && now.commit !== m[1];
      fs.appendFileSync(logFile, (ok ? '==> Neues Image läuft (' + now.commit.slice(0, 7) + ')\nUPDATE_RESULT=success '
        : '==> Neu gestartet, aber gleiche Version\nUPDATE_RESULT=noupdate ') + new Date().toISOString() + '\n');
    }
  } catch (e) { /* kein Update angefangen */ }

  function installed() {
    try {
      const v = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      return v && typeof v.commit === 'string' ? v : null;
    } catch (e) { return null; }
  }

  // 'systemd': Knopf möglich; 'watchtower': Knopf im Docker-Container über Watchtower;
  // 'console': erst einmal per Konsole aktualisieren; 'docker': Update über den Container
  // (z. B. CapRover); 'none': unbekannte Installation
  function mode() {
    if (fs.existsSync(PATH_UNIT)) return 'systemd';
    if (UPDATE_URL && UPDATE_TOKEN) return 'watchtower';
    if (fs.existsSync('/.dockerenv')) return 'docker';
    if (installed() || fs.existsSync('/etc/systemd/system/bts-liveticker.service')) return 'console';
    return 'none';
  }

  function github(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': 'bts-liveticker', Accept: 'application/vnd.github+json' },
        timeout: 8000,
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('GitHub antwortet ' + res.statusCode));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
      req.on('error', reject);
    });
  }

  const title = (c) => String((c.commit && c.commit.message) || '').split('\n')[0].slice(0, 160);

  // Neueste Version und die Änderungen seit der installierten
  async function latest(force) {
    const v = installed();
    const repo = (v && v.repo) || 'frankjuchim/bts-liveticker-v2';
    const branch = (v && v.branch) || 'main';
    const key = repo + '#' + branch + '#' + (v ? v.commit : '');
    if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data;
    const base = 'https://api.github.com/repos/' + repo;
    const head = await github(base + '/commits/' + encodeURIComponent(branch));
    const data = {
      commit: head.sha,
      date: head.commit && head.commit.committer && head.commit.committer.date,
      message: title(head),
      behind: null,
      changes: [],
    };
    if (v && v.commit === head.sha) data.behind = 0;
    else if (v) {
      try {
        const cmp = await github(base + '/compare/' + v.commit + '...' + head.sha);
        data.behind = cmp.ahead_by;
        data.changes = (cmp.commits || []).slice(-20).reverse().map((c) => ({
          message: title(c), date: c.commit && c.commit.committer && c.commit.committer.date,
        }));
      } catch (e) { /* ältere Version nicht mehr bekannt – egal */ }
    }
    cache = { at: Date.now(), key, data };
    return data;
  }

  function log() {
    try {
      const s = fs.readFileSync(logFile, 'utf8');
      return s.split('\n').slice(-40).join('\n');
    } catch (e) { return ''; }
  }

  function running() {
    const l = log();
    return fs.existsSync(requestFile) || (/^UPDATE_STARTED/m.test(l) && !/^UPDATE_RESULT=/m.test(l));
  }

  function start() {
    const md = mode();
    if (md === 'watchtower') return startWatchtower();
    if (md !== 'systemd') throw new Error('Update per Knopf ist hier nicht eingerichtet');
    fs.writeFileSync(requestFile, new Date().toISOString() + '\n');
  }

  // Watchtower holt das neue Image und ersetzt diesen Container – die Antwort kommt dann
  // nicht mehr an. Kommt sie doch, gab es nichts zu aktualisieren (oder einen Fehler).
  function startWatchtower() {
    if (running()) throw new Error('Update läuft bereits');
    const v = installed();
    fs.writeFileSync(logFile, 'UPDATE_STARTED ' + new Date().toISOString() + ' von ' + (v ? v.commit : 'unbekannt') + '\n' +
      '==> Watchtower holt das neue Image und startet den Liveticker neu …\n');
    const done = (line) => fs.appendFileSync(logFile, line + '\n');
    let url;
    try { url = new URL(UPDATE_URL); } catch (e) { throw new Error('UPDATE_URL ist keine gültige Adresse'); }
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + UPDATE_TOKEN },
      timeout: 15 * 60 * 1000,
    }, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode === 200) done('==> Kein neueres Image gefunden\nUPDATE_RESULT=noupdate ' + new Date().toISOString());
        else done('!! Watchtower antwortet ' + res.statusCode + (res.statusCode === 401 ? ' (UPDATE_TOKEN passt nicht)' : '') +
          '\nUPDATE_RESULT=error ' + new Date().toISOString());
      });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', (e) => done('!! Watchtower nicht erreichbar: ' + e.message + '\nUPDATE_RESULT=error ' + new Date().toISOString()));
    req.end();
  }

  return { installed, mode, latest, log, running, start };
}

module.exports = { create };
