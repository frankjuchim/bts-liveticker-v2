// Nationen als kleine Flagge: BTS/BTP liefern IOC-Ländercodes (GER, DEN, …), die Flaggen
// (public/flags/, „flag-icons“, MIT-Lizenz) sind nach ISO-Codes benannt.
(function () {
  'use strict';
  var IOC = {
    AFG: 'af', ALB: 'al', ALG: 'dz', AND: 'ad', ANG: 'ao', ANT: 'ag', ARG: 'ar', ARM: 'am', ARU: 'aw', ASA: 'as',
    AUS: 'au', AUT: 'at', AZE: 'az', BAH: 'bs', BAN: 'bd', BAR: 'bb', BDI: 'bi', BEL: 'be', BEN: 'bj', BER: 'bm',
    BHU: 'bt', BIH: 'ba', BIZ: 'bz', BLR: 'by', BOL: 'bo', BOT: 'bw', BRA: 'br', BRN: 'bh', BRU: 'bn', BUL: 'bg',
    BUR: 'bf', CAF: 'cf', CAM: 'kh', CAN: 'ca', CAY: 'ky', CGO: 'cg', CHA: 'td', CHI: 'cl', CHN: 'cn', CIV: 'ci',
    CMR: 'cm', COD: 'cd', COK: 'ck', COL: 'co', COM: 'km', CPV: 'cv', CRC: 'cr', CRO: 'hr', CUB: 'cu', CYP: 'cy',
    CZE: 'cz', DEN: 'dk', DJI: 'dj', DMA: 'dm', DOM: 'do', ECU: 'ec', EGY: 'eg', ERI: 'er', ESA: 'sv', ESP: 'es',
    EST: 'ee', ETH: 'et', FIJ: 'fj', FIN: 'fi', FRA: 'fr', FRO: 'fo', FSM: 'fm', GAB: 'ga', GAM: 'gm', GBR: 'gb',
    GBS: 'gw', GEO: 'ge', GEQ: 'gq', GER: 'de', GHA: 'gh', GIB: 'gi', GRE: 'gr', GRL: 'gl', GRN: 'gd', GUA: 'gt',
    GUI: 'gn', GUM: 'gu', GUY: 'gy', HAI: 'ht', HKG: 'hk', HON: 'hn', HUN: 'hu', INA: 'id', IND: 'in', IRI: 'ir',
    IRL: 'ie', IRQ: 'iq', ISL: 'is', ISR: 'il', ISV: 'vi', ITA: 'it', IVB: 'vg', JAM: 'jm', JOR: 'jo', JPN: 'jp',
    KAZ: 'kz', KEN: 'ke', KGZ: 'kg', KIR: 'ki', KOR: 'kr', KOS: 'xk', KSA: 'sa', KUW: 'kw', LAO: 'la', LAT: 'lv',
    LBA: 'ly', LBN: 'lb', LBR: 'lr', LCA: 'lc', LES: 'ls', LIE: 'li', LTU: 'lt', LUX: 'lu', MAC: 'mo', MAD: 'mg',
    MAR: 'ma', MAS: 'my', MAW: 'mw', MDA: 'md', MDV: 'mv', MEX: 'mx', MGL: 'mn', MHL: 'mh', MKD: 'mk', MLI: 'ml',
    MLT: 'mt', MNE: 'me', MON: 'mc', MOZ: 'mz', MRI: 'mu', MTN: 'mr', MYA: 'mm', NAM: 'na', NCA: 'ni', NCL: 'nc',
    NED: 'nl', NEP: 'np', NGR: 'ng', NIG: 'ne', NOR: 'no', NRU: 'nr', NZL: 'nz', OMA: 'om', PAK: 'pk', PAN: 'pa',
    PAR: 'py', PER: 'pe', PHI: 'ph', PLE: 'ps', PLW: 'pw', PNG: 'pg', POL: 'pl', POR: 'pt', PRK: 'kp', PUR: 'pr',
    QAT: 'qa', ROU: 'ro', RSA: 'za', RUS: 'ru', RWA: 'rw', SAM: 'ws', SEN: 'sn', SEY: 'sc', SGP: 'sg', SKN: 'kn',
    SLE: 'sl', SLO: 'si', SMR: 'sm', SOL: 'sb', SOM: 'so', SRB: 'rs', SRI: 'lk', SSD: 'ss', STP: 'st', SUD: 'sd',
    SUI: 'ch', SUR: 'sr', SVK: 'sk', SWE: 'se', SWZ: 'sz', SYR: 'sy', TAH: 'pf', TAN: 'tz', TGA: 'to', THA: 'th',
    TJK: 'tj', TKM: 'tm', TLS: 'tl', TOG: 'tg', TPE: 'tw', TTO: 'tt', TUN: 'tn', TUR: 'tr', TUV: 'tv', UAE: 'ae',
    UGA: 'ug', UKR: 'ua', URU: 'uy', USA: 'us', UZB: 'uz', VAN: 'vu', VEN: 've', VIE: 'vn', VIN: 'vc', YEM: 'ye',
    ZAM: 'zm', ZIM: 'zw',
    // Badminton-Verbände ohne eigenen IOC-Code
    ENG: 'gb-eng', SCO: 'gb-sct', WAL: 'gb-wls', NIR: 'gb-nir', REU: 're', MTQ: 'mq', GLP: 'gp', NFK: 'nf',
    // ISO-Codes, falls BTP sie so liefert
    DEU: 'de', DNK: 'dk', NLD: 'nl', CHE: 'ch', PRT: 'pt', GRC: 'gr', HRV: 'hr', SVN: 'si', MYS: 'my', IDN: 'id',
  };

  function iso(code) { return IOC[String(code || '').toUpperCase()] || null; }

  // <img> mit der Flagge oder null (unbekannter Code)
  function flag(code) {
    var f = iso(code);
    if (!f) return null;
    var img = document.createElement('img');
    img.className = 'flag';
    img.src = '/flags/' + f + '.svg';
    img.alt = code;
    img.title = code;
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  // Flaggen nur zeigen, wenn mehr als eine Nation vorkommt (sonst überall dieselbe Flagge)
  function useful(state) {
    var seen = {};
    var n = 0;
    function add(list) { (list || []).forEach(function (c) { if (c && iso(c) && !seen[c]) { seen[c] = 1; n++; } }); }
    ((state && state.matches) || []).forEach(function (m) { add(m.homeNations); add(m.awayNations); });
    ((state && state.upcoming) || []).forEach(function (m) { add(m.homeNations); add(m.awayNations); });
    return n > 1;
  }

  window.Nations = { iso: iso, flag: flag, useful: useful };
})();
