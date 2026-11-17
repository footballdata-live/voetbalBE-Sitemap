// VoetbalBE Sitemap - kern.js
//
// Pure functies zonder Chrome-API's: datums in Brusselse tijd, de lastmod-regels,
// het bouwen van sitemap.xml en sitemap-data.json, en de git-blob-sha.
// Geladen door background.js (importScripts) en los te testen in Node.

(function (wereld) {
  'use strict';

  const FORUM = 'https://voetbalbe.boards.net';
  const POSTS_PER_PAGINA = 20;          // gemeten in test v3: 20 posts per threadpagina
  const TIJDZONE = 'Europe/Brussels';
  const DAG_MS = 24 * 3600 * 1000;

  // -------------------------------------------------------------------------
  // Datums in Brusselse tijd
  // -------------------------------------------------------------------------

  const opmaak = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIJDZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23'
  });

  function delen(ms) {
    const o = {};
    opmaak.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
    return { j: Number(o.year), m: Number(o.month), d: Number(o.day), u: Number(o.hour), mi: Number(o.minute), s: Number(o.second), wd: o.weekday };
  }

  function twee(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // YYYY-MM-DD van een tijdstip, in Brusselse tijd.
  function datum(ms) {
    const p = delen(ms);
    return p.j + '-' + twee(p.m) + '-' + twee(p.d);
  }

  function isZondag(ms) {
    return delen(ms).wd === 'Sun';
  }

  // UTC-tijdstip (ms) van een Brusselse wandkloktijd.
  function brusselNaarUtc(j, m, d, u, mi) {
    const doel = Date.UTC(j, m - 1, d, u, mi);
    let gok = doel;
    for (let i = 0; i < 4; i++) {
      const p = delen(gok);
      const verschil = Date.UTC(p.j, p.m - 1, p.d, p.u, p.mi) - doel;
      if (verschil === 0) break;
      gok -= verschil;
    }
    return gok;
  }

  // Vandaag (Brussel) om <uur>:00, als UTC-ms.
  function vandaagOm(ms, uur) {
    const p = delen(ms);
    return brusselNaarUtc(p.j, p.m, p.d, uur, 0);
  }

  // Het eerstvolgende <uur>:00 (Brussel) na ms.
  function volgendeRun(ms, uur) {
    const vandaag = vandaagOm(ms, uur);
    if (vandaag > ms) return vandaag;
    const p = delen(vandaag + DAG_MS);
    return brusselNaarUtc(p.j, p.m, p.d, uur, 0);
  }

  // Het laatste geplande <uur>:00 (Brussel) op of voor ms.
  function laatsteGepland(ms, uur) {
    const vandaag = vandaagOm(ms, uur);
    if (vandaag <= ms) return vandaag;
    const p = delen(vandaag - DAG_MS);
    return brusselNaarUtc(p.j, p.m, p.d, uur, 0);
  }

  // Moet er nu een run gebeuren? Ja als de laatste voltooide run van voor het
  // laatste geplande uur is (of als er nog nooit een run was).
  function moetDraaien(nu, laatsteRunMs, uur) {
    if (!laatsteRunMs) return true;
    return laatsteRunMs < laatsteGepland(nu, uur);
  }

  function dagenTussen(datumA, datumB) {
    const a = datumA.split('-').map(Number);
    const b = datumB.split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAG_MS);
  }

  // Volledige crawl: als er nog geen is geweest, op zondag (eenmaal), of als de
  // vorige 7 dagen of langer geleden is (een gemiste zondag wordt ingehaald).
  function soortVoor(nu, laatsteVolledig) {
    if (!laatsteVolledig) return 'volledig';
    const vandaag = datum(nu);
    if (laatsteVolledig === vandaag) return 'dagelijks';
    if (isZondag(nu)) return 'volledig';
    if (dagenTussen(laatsteVolledig, vandaag) >= 7) return 'volledig';
    return 'dagelijks';
  }

  // -------------------------------------------------------------------------
  // Threads, pagina's en lastmod
  // -------------------------------------------------------------------------

  // Aantal pagina's van een thread: (reacties + 1) / 20, naar boven afgerond.
  // m = hoogste paginanummer uit de links in de threadrij (controle).
  function paginasVan(reacties, m) {
    const r = typeof reacties === 'number' && reacties >= 0 ? reacties : 0;
    return Math.max(1, Math.ceil((r + 1) / POSTS_PER_PAGINA), m || 1);
  }

  // Verwerkt een threadrij uit een boardpagina in de toestand.
  //   threads    : toestand.threads (wordt aangepast)
  //   rij        : { id, href, replies, maxPag }
  //   bord       : board-ID (string)
  //   vandaag    : YYYY-MM-DD
  //   metDatums  : false bij de allereerste crawl (dan is "nieuw" niet echt nieuw)
  // Geeft 'nieuw', 'gewijzigd' of 'gelijk'.
  function pasRijToe(threads, rij, bord, vandaag, metDatums) {
    const r = typeof rij.replies === 'number' && rij.replies >= 0 ? rij.replies : null;
    const oud = threads[rij.id];
    if (!oud) {
      const t = { b: bord, p: rij.href, r: r, m: rij.maxPag || 1, d: {} };
      if (metDatums) {
        const n = paginasVan(r, t.m);
        for (let i = 1; i <= n; i++) t.d[i] = vandaag;
      }
      threads[rij.id] = t;
      return 'nieuw';
    }
    oud.b = bord;
    oud.p = rij.href;
    oud.m = rij.maxPag || 1;
    if (r === null) return 'gelijk';
    if (oud.r === null || oud.r === undefined) {
      oud.r = r;
      return 'gelijk';
    }
    if (oud.r === r) return 'gelijk';

    const oudN = paginasVan(oud.r, 1);
    const nieuwN = paginasVan(r, 1);
    if (r > oud.r) {
      // Nieuwe posts komen op de laatste pagina, en eventueel op nieuwe pagina's.
      // Was de laatste pagina al vol, dan verandert ze zelf niet.
      const eerste = (oud.r + 1) % POSTS_PER_PAGINA === 0 ? oudN + 1 : oudN;
      for (let i = eerste; i <= nieuwN; i++) oud.d[i] = vandaag;
    } else {
      // Minder reacties: er zijn posts verwijderd. Waar is niet te zien; de
      // laatste pagina is in elk geval veranderd.
      Object.keys(oud.d).forEach((k) => { if (Number(k) > nieuwN) delete oud.d[k]; });
      oud.d[nieuwN] = vandaag;
    }
    oud.r = r;
    return 'gewijzigd';
  }

  function maxDatum(lijst) {
    let max = null;
    lijst.forEach((d) => { if (d && (!max || d > max)) max = d; });
    return max;
  }

  // -------------------------------------------------------------------------
  // Uitvoer
  // -------------------------------------------------------------------------

  function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function numeriek(a, b) {
    return Number(a) - Number(b);
  }

  // Laatste wijziging per board: de jongste datum van zijn threads.
  function boardDatums(toestand) {
    const per = {};
    Object.keys(toestand.threads).forEach((id) => {
      const t = toestand.threads[id];
      const d = maxDatum(Object.keys(t.d).map((k) => t.d[k]));
      if (d && (!per[t.b] || d > per[t.b])) per[t.b] = d;
    });
    return per;
  }

  // Bouwt sitemap.xml. Enkel publieke boards, hun threads en publieke pages.
  function bouwXml(toestand) {
    const regels = [];
    const telling = { home: 0, boards: 0, boardpaginas: 0, pages: 0, threads: 0, threadpaginas: 0, metLastmod: 0 };
    const gezien = new Set();
    const voeg = (loc, lastmod, soort) => {
      if (gezien.has(loc)) return;
      gezien.add(loc);
      regels.push('  <url><loc>' + xmlEsc(loc) + '</loc>' + (lastmod ? '<lastmod>' + lastmod + '</lastmod>' : '') + '</url>');
      telling[soort]++;
      if (lastmod) telling.metLastmod++;
    };

    const perBoard = boardDatums(toestand);
    const publiek = {};
    Object.keys(toestand.boards).forEach((id) => { if (toestand.boards[id].publiek) publiek[id] = true; });

    voeg(FORUM + '/', maxDatum(Object.keys(publiek).map((id) => perBoard[id])), 'home');

    Object.keys(publiek).sort(numeriek).forEach((id) => {
      const b = toestand.boards[id];
      const pad = b.pad || '/board/' + id;
      const d = perBoard[id] || null;
      voeg(FORUM + pad, d, 'boards');
      for (let n = 2; n <= (b.paginas || 1); n++) voeg(FORUM + pad + '?page=' + n, d, 'boardpaginas');
    });

    Object.keys(toestand.pages).sort().forEach((k) => {
      const p = toestand.pages[k];
      if (p.publiek) voeg(FORUM + '/page/' + p.naam, null, 'pages');
    });

    Object.keys(toestand.threads).sort(numeriek).forEach((id) => {
      const t = toestand.threads[id];
      if (!publiek[t.b]) return;
      const n = paginasVan(t.r, t.m);
      voeg(FORUM + t.p, t.d[1] || null, 'threads');
      for (let i = 2; i <= n; i++) voeg(FORUM + t.p + '?page=' + i, t.d[i] || null, 'threadpaginas');
    });

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      regels.join('\n') + '\n</urlset>\n';
    return { xml: xml, aantal: regels.length, telling: telling };
  }

  // Ouderboard uit de kruimels: het board net voor het eigen board.
  function ouderUit(id, kruimel) {
    if (!Array.isArray(kruimel) || !kruimel.length) return null;
    const i = kruimel.indexOf(String(id));
    if (i > 0) return kruimel[i - 1];
    if (i === -1) return kruimel[kruimel.length - 1];
    return null;
  }

  // Bouwt sitemap-data.json: de structuur voor de latere sitemap-pagina.
  // Bevat geen tijdstip van de run, zodat het bestand enkel verandert als de
  // inhoud verandert.
  function bouwData(toestand) {
    const perBoard = boardDatums(toestand);
    const aantal = {};
    Object.keys(toestand.threads).forEach((id) => {
      const b = toestand.threads[id].b;
      aantal[b] = (aantal[b] || 0) + 1;
    });
    const boards = Object.keys(toestand.boards).filter((id) => toestand.boards[id].publiek).sort(numeriek).map((id) => {
      const b = toestand.boards[id];
      return {
        id: Number(id),
        naam: b.naam || '',
        pad: b.pad || '/board/' + id,
        ouder: ouderUit(id, b.kruimel) ? Number(ouderUit(id, b.kruimel)) : null,
        threads: aantal[id] || 0,
        paginas: b.paginas || 1,
        laatst: perBoard[id] || null
      };
    });
    const pages = Object.keys(toestand.pages).sort().filter((k) => toestand.pages[k].publiek).map((k) => {
      const p = toestand.pages[k];
      return { naam: p.naam, pad: '/page/' + p.naam, titel: p.titel || '' };
    });
    return {
      versie: 1,
      laatsteWijziging: maxDatum(boards.map((b) => b.laatst)),
      boards: boards,
      pages: pages
    };
  }

  // -------------------------------------------------------------------------
  // Git-blob-sha (om enkel te committen wat echt veranderd is)
  // -------------------------------------------------------------------------

  async function gitBlobSha(tekst) {
    const inhoud = new TextEncoder().encode(tekst);
    const kop = new TextEncoder().encode('blob ' + inhoud.length + '\0');
    const alles = new Uint8Array(kop.length + inhoud.length);
    alles.set(kop, 0);
    alles.set(inhoud, kop.length);
    const hash = await crypto.subtle.digest('SHA-1', alles);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function legeToestand() {
    return { versie: 1, laatsteVolledig: null, boards: {}, threads: {}, pages: {} };
  }

  const kern = {
    FORUM, POSTS_PER_PAGINA,
    delen, datum, isZondag, brusselNaarUtc, vandaagOm, volgendeRun, laatsteGepland, moetDraaien,
    dagenTussen, soortVoor, paginasVan, pasRijToe, maxDatum, xmlEsc, boardDatums, bouwXml,
    ouderUit, bouwData, gitBlobSha, legeToestand
  };

  wereld.SitemapKern = kern;
  if (typeof module !== 'undefined' && module.exports) module.exports = kern;
})(typeof self !== 'undefined' ? self : globalThis);
