// VoetbalBE Sitemap 0.2.0 (18 november 2026)
//
// Crawlt voetbalbe.boards.net in gastweergave en bouwt sitemap.xml,
// sitemap-data.json en sitemap-state.json. Publiceert naar de repo
// footballdata-live/voetbalBE-Sitemap, enkel als de droge stand uit staat.
//
// 0.2.0: na de crawl leest de extensie de openingspost van elk echt nieuw
// topic (hoger ID dan het hoogste gekende, zonder board 25) en stuurt ze
// in één call naar de intake-route van de opinions-Worker, die beslist wat
// naar de socials gaat. Adres en sleutel staan in de opties, niet in de
// code. Zonder adres of sleutel wordt deze stap overgeslagen.
//
// Wanneer:
//   - dagelijks om 09:00 (Brussel) via een timer in Chrome;
//   - een gemist uur wordt ingehaald bij het opstarten van Chrome (aanmelden
//     op de Chromebook) of bij een bezoek aan het forum;
//   - op zondag, of als de vorige volledige crawl 7 dagen of langer geleden is,
//     een volledige crawl; anders enkel wat veranderd is.
//
// Hoe:
//   - een geminimaliseerd gewoon venster op het forum; alle verzoeken gaan
//     ZONDER cookies (credentials: 'omit'), dus als gast. Bewezen in test v2:
//     318 verzoeken, geen PoW-blokkade. Je gele bollen blijven staan.
//   - per board wordt de voortgang bewaard; een onderbroken run gaat bij de
//     volgende gelegenheid verder.
//
// Veiligheid:
//   - de GitHub-token staat enkel in chrome.storage.local, komt nooit in een
//     verslag, en wordt enkel naar api.github.com gestuurd;
//   - de extensie schrijft enkel naar REPO, nergens anders.

importScripts('kern.js');
const K = self.SitemapKern;

const FORUM = 'https://voetbalbe.boards.net';
const REPO = 'footballdata-live/voetbalBE-Sitemap';
const TAK = 'main';
const RUN_UUR = 9;
const WEKKER = 'sitemap-dagelijks';

const PAUZE_MS = 800;                    // tussen twee verzoeken, zoals in test v2
const HERPOGINGEN_MS = [5000, 10000, 20000];
const MAX_PAGINAS_PER_BOARD = 400;
const MAX_CUSTOM_PAGES = 200;
const SLOT_VERVAL_MS = 15 * 60 * 1000;
const MAX_HERVATTINGEN = 3;
const KRIMP_GRENS = 0.9;                 // minder dan 90% van de vorige keer = niet publiceren
const MAX_LOG = 400;

// Socials (0.2.0)
const SOCIAL_MAX_TOPICS = 60;            // per call naar de Worker, zoals de Worker toelaat
const SOCIAL_BOARDS_OVERSLAAN = ['25'];  // matchtopics: die regelt de social bot zelf

// Gekende boards en pages: altijd bezocht, ook als er (nog) geen link naar is.
const BEKENDE_BOARDS = ['89', '4', '90', '91', '72', '9', '14', '12', '11', '13', '15', '10', '75', '76', '16', '62', '61', '60', '17', '18', '22', '25', '95'];
const BEKENDE_PAGES = ['Matchcenter', 'games'];

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const lees = (sleutels) => chrome.storage.local.get(sleutels);
const zet = (obj) => chrome.storage.local.set(obj);
const fout = (e) => (e && e.message ? e.message : String(e));

function tijd(ms) {
  try {
    return new Date(ms).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return new Date(ms).toISOString();
  }
}

async function meld(titel, tekst) {
  try {
    await chrome.notifications.create('sitemap-' + Date.now(), {
      type: 'basic', iconUrl: 'icoon128.png', title: titel, message: tekst
    });
  } catch (e) { /* meldingen zijn bijzaak */ }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

async function zetWekker() {
  const wanneer = K.volgendeRun(Date.now(), RUN_UUR);
  await chrome.alarms.create(WEKKER, { when: wanneer });
}

chrome.runtime.onInstalled.addListener(() => { zetWekker(); });
chrome.runtime.onStartup.addListener(() => { zetWekker(); controleer('opstart'); });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== WEKKER) return;
  zetWekker();
  controleer('wekker');
});

chrome.runtime.onMessage.addListener((bericht, afzender, antwoord) => {
  if (!bericht || afzender.id !== chrome.runtime.id) return;
  if (bericht.type === 'paginabezoek') {
    if (afzender.tab && afzender.tab.incognito) return;
    controleer('paginabezoek');
  } else if (bericht.type === 'nu' && (bericht.soort === 'dagelijks' || bericht.soort === 'volledig')) {
    start(bericht.soort, 'knop').catch((e) => console.warn('Sitemap:', fout(e)));
  } else if (bericht.type === 'github_test') {
    githubTest().then(antwoord, (e) => antwoord({ ok: false, tekst: fout(e) }));
    return true;
  } else if (bericht.type === 'social_test') {
    socialTest().then(antwoord, (e) => antwoord({ ok: false, tekst: fout(e) }));
    return true;
  } else if (bericht.type === 'wekker') {
    chrome.alarms.get(WEKKER).then((a) => antwoord({ wanneer: a ? a.scheduledTime : null }));
    return true;
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('verslag.html') });
});

function slotBezet(slot) {
  return !!(slot && Date.now() - slot.start < SLOT_VERVAL_MS);
}

let bezig = false;

// Beslist of er nu een run moet gebeuren (gepland, ingehaald of hervat).
async function controleer(bron) {
  if (bezig) return;
  const o = await lees(['sm_slot', 'sm_run', 'sm_laatste_run']);
  if (slotBezet(o.sm_slot)) return;
  const nu = Date.now();
  const run = o.sm_run;
  if (run && !run.klaar && run.datum === K.datum(nu) && (run.hervattingen || 0) < MAX_HERVATTINGEN) {
    return start(null, bron + ' (hervat)').catch((e) => console.warn('Sitemap:', fout(e)));
  }
  if (!K.moetDraaien(nu, o.sm_laatste_run, RUN_UUR)) return;
  return start(null, bron).catch((e) => console.warn('Sitemap:', fout(e)));
}

// ---------------------------------------------------------------------------
// Lezen in de pagina (MAIN-wereld, zonder cookies)
// ---------------------------------------------------------------------------

// Deze functie wordt in het forumvenster uitgevoerd en moet op zichzelf staan.
async function leesInPagina(pad, boardId) {
  const uit = { status: 0, fout: '', eind: '', titel: '', oops: false, lengte: 0, rijen: [], boards: [], pages: [], laatstePagina: 0, kruimel: [] };
  let res;
  let html = '';
  try {
    res = await fetch(pad, { credentials: 'omit', cache: 'no-store' });
    html = await res.text();
  } catch (e) {
    uit.fout = String((e && e.message) || e);
    return uit;
  }
  uit.status = res.status;
  uit.lengte = html.length;
  try {
    const u = new URL(res.url);
    uit.eind = u.pathname + u.search;
  } catch (e) { /* leeg laten */ }
  if (res.status !== 200) return uit;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const titel = (doc.title || '').trim();
  uit.oops = /^Oops/.test(titel);
  uit.titel = titel.split('|')[0].trim();
  const origin = location.origin;

  // Threadrijen (selectors bewezen in test v2).
  doc.querySelectorAll('tr.thread').forEach((tr) => {
    const a = tr.querySelector('.js-thread__link') || tr.querySelector('a[href*="/thread/"]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    const m = /\/thread\/(\d+)/.exec(href);
    if (!m) return;
    let pathname = href;
    try { pathname = new URL(href, origin).pathname; } catch (e) { /* href laten */ }
    let maxPag = 1;
    tr.querySelectorAll('a[href*="/thread/' + m[1] + '"]').forEach((x) => {
      const p = /[?&]page=(\d+)/.exec(x.getAttribute('href') || '');
      if (p) maxPag = Math.max(maxPag, Number(p[1]));
    });
    const rep = tr.querySelector('td.replies');
    let replies = null;
    if (rep) {
      const n = parseInt(rep.textContent.replace(/\D/g, ''), 10);
      replies = isNaN(n) ? null : n;
    }
    uit.rijen.push({ id: m[1], href: pathname, replies: replies, maxPag: maxPag });
  });

  // Links naar boards en custom pages.
  const boards = {};
  const pages = {};
  const meldBoard = (id, p) => { if (!boards[id] || p.length > boards[id].length) boards[id] = p; };
  doc.querySelectorAll('a[href]').forEach((a) => {
    let u;
    try { u = new URL(a.getAttribute('href'), origin); } catch (e) { return; }
    if (u.origin !== origin) return;
    const d = u.pathname.split('/').filter(Boolean);
    if (d[0] === 'board' && /^\d+$/.test(d[1] || '')) {
      meldBoard(d[1], '/' + d.join('/'));
      if (boardId && d[1] === String(boardId)) {
        const p = Number(u.searchParams.get('page'));
        if (p > uit.laatstePagina) uit.laatstePagina = p;
      }
    }
    if (d[0] === 'page' && d[1]) {
      let n = d[1];
      try { n = decodeURIComponent(n); } catch (e) { /* laten */ }
      pages[n] = 1;
    }
  });
  // Ook in de broncode zelf: de fanpages staan daar enkel als tekst (test v1/v2).
  const re = /(https?:\/\/[a-z0-9.-]+)?\/(board|page)\/([A-Za-z0-9_-]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) {
      if (m[1].toLowerCase().indexOf('voetbalbe.boards.net') === -1) continue;
    } else if (/[A-Za-z0-9.]/.test(html[m.index - 1] || '')) {
      continue;
    }
    if (m[2].toLowerCase() === 'board') {
      if (/^\d+$/.test(m[3])) meldBoard(m[3], '/board/' + m[3]);
    } else {
      pages[m[3]] = 1;
    }
  }
  uit.boards = Object.keys(boards).map((id) => [id, boards[id]]);
  uit.pages = Object.keys(pages);

  // Kruimelpad (voor het ouderboard in sitemap-data.json; nog niet getest).
  doc.querySelectorAll('#navigation-tree a[href]').forEach((a) => {
    const k = /\/board\/(\d+)/.exec(a.getAttribute('href') || '');
    if (k && uit.kruimel.indexOf(k[1]) === -1) uit.kruimel.push(k[1]);
  });
  return uit;
}

// Eén topic lezen voor de socials (0.2.0). Ook in het forumvenster, zonder
// cookies, en op zichzelf staand. Selectors bewezen in de analyse van 18/11
// (686 topics in gastweergave): tr.item.post, .message, .poll.show.
async function leesTopicInPagina(pad) {
  const uit = { status: 0, fout: '', titel: '', oops: false, tekst: null, domeinen: [], poll: false, jplmc: false, auteur_id: null };
  let res;
  let html = '';
  try {
    res = await fetch(pad, { credentials: 'omit', cache: 'no-store' });
    html = await res.text();
  } catch (e) {
    uit.fout = String((e && e.message) || e);
    return uit;
  }
  uit.status = res.status;
  if (res.status !== 200) return uit;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const titel = (doc.title || '').trim();
  uit.oops = /^Oops/.test(titel);
  uit.titel = titel.split('|')[0].trim();
  if (uit.oops) return uit;
  uit.poll = !!doc.querySelector('.poll.show');

  const eerste = doc.querySelector('tr.item.post');
  if (!eerste) return uit;
  const u = eerste.querySelector('a.o-user-link, a.user-link');
  if (u) {
    const m = /\/user\/(\d+)/.exec(u.getAttribute('href') || '');
    if (m) uit.auteur_id = Number(m[1]);
  }
  const msg = eerste.querySelector('.message');
  if (!msg) return uit;
  const kopie = msg.cloneNode(true);
  // Citaten weg: dat is andermans tekst.
  kopie.querySelectorAll('blockquote, .quote').forEach((q) => { if (q.parentNode) q.parentNode.removeChild(q); });
  kopie.querySelectorAll('a[href]').forEach((a) => {
    let h;
    try { h = new URL(a.getAttribute('href'), location.origin).hostname; } catch (e) { return; }
    if (h !== location.hostname && uit.domeinen.indexOf(h) === -1 && uit.domeinen.length < 20) uit.domeinen.push(h);
  });
  const tekst = (kopie.textContent || '').replace(/\s+/g, ' ').trim();
  uit.tekst = tekst.length > 4000 ? tekst.substring(0, 4000) : tekst;
  uit.jplmc = /\[JPLMC id=/i.test(tekst);
  return uit;
}

// ---------------------------------------------------------------------------
// Het crawlvenster
// ---------------------------------------------------------------------------

async function voerUit(tabId, func, args) {
  const res = await chrome.scripting.executeScript({ target: { tabId: tabId }, world: 'MAIN', func: func, args: args || [] });
  return res && res[0] ? res[0].result : undefined;
}

async function openVenster() {
  let venster;
  try {
    venster = await chrome.windows.create({ url: FORUM + '/', state: 'minimized', focused: false });
  } catch (e) {
    venster = await chrome.windows.create({ url: FORUM + '/', focused: false });
  }
  let tabs = venster.tabs;
  if (!tabs || !tabs.length) tabs = await chrome.tabs.query({ windowId: venster.id });
  const tabId = tabs[0].id;
  // Wachten tot de forumpagina geladen is (de PoW-controle passeert vanzelf).
  const einde = Date.now() + 60000;
  while (Date.now() < einde) {
    try {
      const klaar = await voerUit(tabId, () => !!(window.pb && document.readyState === 'complete'));
      if (klaar) return { vensterId: venster.id, tabId: tabId };
    } catch (e) { /* pagina laadt nog */ }
    await wacht(1500);
  }
  try { await chrome.windows.remove(venster.id); } catch (e) { /* al dicht */ }
  throw new Error('forumpagina niet geladen na 60 s');
}

// Eén pagina lezen, met herpogingen bij een netwerkfout, HTTP 202 (PoW) of 5xx.
// Gooit 'venster' als het crawlvenster weg is. Met `lezer` (0.2.0) wordt een
// andere leesfunctie gebruikt, met enkel het pad als argument.
async function haal(ctx, pad, boardId, lezer) {
  for (let poging = 0; poging <= HERPOGINGEN_MS.length; poging++) {
    await wacht(PAUZE_MS);
    let r;
    try {
      r = lezer ? await voerUit(ctx.tabId, lezer, [pad]) : await voerUit(ctx.tabId, leesInPagina, [pad, boardId || null]);
    } catch (e) {
      const v = new Error('crawlvenster niet meer bereikbaar: ' + fout(e));
      v.venster = true;
      throw v;
    }
    ctx.run.tellers.verzoeken++;
    if (r && r.status === 202) ctx.run.tellers.pow++;
    const opnieuw = !r || r.fout || r.status === 202 || r.status >= 500;
    if (!opnieuw) return r;
    if (poging < HERPOGINGEN_MS.length) {
      ctx.run.tellers.herpogingen++;
      await wacht(HERPOGINGEN_MS[poging]);
    } else {
      return r;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// De run
// ---------------------------------------------------------------------------

function log(run, tekst, ok) {
  run.log.push({ s: Math.round((Date.now() - run.start) / 1000), tekst: tekst, ok: ok === undefined ? null : ok });
  if (run.log.length > MAX_LOG) run.log.splice(0, run.log.length - MAX_LOG);
}

function nieuweRun(soort, bron, nu) {
  return {
    id: String(nu), soort: soort, bron: bron, datum: K.datum(nu), start: nu, fase: 'home', klaar: false,
    hervattingen: 0, wachtrij: [], gedaan: [], mislukt: [], pagesRij: [], pagesGedaan: [],
    gezienThreads: [], boards: {}, pages: {},
    tellers: { verzoeken: 0, herpogingen: 0, pow: 0, nieuw: 0, gewijzigd: 0, boardpaginas: 0 },
    log: []
  };
}

async function bewaar(run, werk) {
  await zet({ sm_run: run, sm_werk: werk, sm_slot: { start: Date.now(), run: run.id } });
}

// soortGevraagd: 'dagelijks' | 'volledig' | null (dan zelf bepalen)
async function start(soortGevraagd, bron) {
  if (bezig) return;
  bezig = true;
  const nu = Date.now();
  let ctx = null;
  try {
    const o = await lees(['sm_slot', 'sm_run', 'sm_werk', 'sm_state']);
    if (slotBezet(o.sm_slot) && !soortGevraagd) return;
    const toestand = o.sm_state || K.legeToestand();
    // Een achtergebleven crawlvenster van een onderbroken run sluiten.
    if (o.sm_run && !o.sm_run.klaar && o.sm_run.vensterId !== undefined) {
      try { await chrome.windows.remove(o.sm_run.vensterId); } catch (e) { /* al dicht */ }
    }

    let run;
    let werk;
    const hervat = !soortGevraagd && o.sm_run && !o.sm_run.klaar && o.sm_run.datum === K.datum(nu) &&
      (o.sm_run.hervattingen || 0) < MAX_HERVATTINGEN && o.sm_werk;
    if (hervat) {
      run = o.sm_run;
      werk = o.sm_werk;
      run.hervattingen = (run.hervattingen || 0) + 1;
      log(run, 'Hervat (' + bron + '), poging ' + run.hervattingen + '.', null);
    } else {
      const soort = soortGevraagd || K.soortVoor(nu, toestand.laatsteVolledig);
      run = nieuweRun(soort, bron, nu);
      werk = JSON.parse(JSON.stringify(toestand));
      log(run, 'Start: ' + soort + ' (' + bron + ').', null);
    }
    await bewaar(run, werk);

    ctx = await openVenster();
    ctx.run = run;
    run.vensterId = ctx.vensterId;
    log(run, 'Forumvenster geopend en geladen.', true);
    await bewaar(run, werk);

    // Een thread die nog niet in de toestand staat, krijgt enkel de datum van
    // vandaag als hij echt nieuw is: een hoger ID dan het hoogste gekende.
    // Een thread die een vorige keer gemist werd (lager ID), krijgt geen datum.
    // Bij de allereerste crawl krijgt niets een datum.
    const ids = Object.keys(toestand.threads).map(Number);
    const maxBekend = ids.length ? Math.max.apply(null, ids) : null;
    const vandaag = run.datum;
    const volledig = run.soort === 'volledig';

    // Fase 1: homepage
    if (run.fase === 'home') {
      const h = await haal(ctx, '/', null);
      if (!h || h.status !== 200) throw new Error('homepage niet gelezen (HTTP ' + (h ? h.status : 0) + (h && h.fout ? ', ' + h.fout : '') + ')');
      const rij = [];
      const voeg = (id) => { if (rij.indexOf(id) === -1) rij.push(id); };
      h.boards.forEach((b) => {
        voeg(b[0]);
        const w = werk.boards[b[0]] || (werk.boards[b[0]] = { naam: '', pad: '/board/' + b[0], kruimel: [], publiek: false, paginas: 0 });
        if (b[1].length > (w.pad || '').length) w.pad = b[1];
      });
      Object.keys(werk.boards).forEach(voeg);
      BEKENDE_BOARDS.forEach(voeg);
      run.wachtrij = rij;
      run.homeBoards = h.boards.length;
      const pagesRij = [];
      const voegPage = (n) => { if (!pagesRij.some((x) => x.toLowerCase() === n.toLowerCase())) pagesRij.push(n); };
      h.pages.forEach(voegPage);
      BEKENDE_PAGES.forEach(voegPage);
      if (volledig) Object.keys(werk.pages).forEach((k) => voegPage(werk.pages[k].naam));
      run.pagesRij = volledig ? pagesRij : pagesRij.filter((n) => !werk.pages[n.toLowerCase()]);
      run.fase = 'boards';
      log(run, 'Homepage: ' + h.boards.length + ' boards en ' + h.pages.length + ' pages in links en broncode.', true);
      await bewaar(run, werk);
    }

    // Fase 2: boards
    const gezien = new Set(run.gezienThreads);
    while (run.fase === 'boards' && run.wachtrij.length) {
      const id = run.wachtrij[0];
      const res = await crawlBoard(ctx, id, werk, gezien, volledig, vandaag, maxBekend);
      run.wachtrij.shift();
      if (res.ok) run.gedaan.push(id); else run.mislukt.push(id);
      run.boards[id] = res;
      run.gezienThreads = Array.from(gezien);
      log(run, 'Board ' + id + (res.naam ? ' (' + res.naam + ')' : '') + ': ' + res.tekst, res.ok);
      await bewaar(run, werk);
    }
    if (run.fase === 'boards') {
      run.fase = 'pages';
      await bewaar(run, werk);
    }

    // Fase 3: custom pages
    while (run.fase === 'pages' && run.pagesRij.length && run.pagesGedaan.length < MAX_CUSTOM_PAGES) {
      const naam = run.pagesRij.shift();
      const k = naam.toLowerCase();
      if (run.pagesGedaan.indexOf(k) !== -1) continue;
      run.pagesGedaan.push(k);
      const r = await haal(ctx, '/page/' + encodeURIComponent(naam), null);
      if (!r || r.status === 0 || r.status === 202 || r.status >= 500) {
        run.pages[naam] = 'niet gelezen';
        log(run, 'Page ' + naam + ': niet gelezen (' + (r ? (r.fout || 'HTTP ' + r.status) : 'geen antwoord') + ').', false);
        continue;
      }
      const publiek = r.status === 200 && !r.oops;
      const vorig = werk.pages[k];
      werk.pages[k] = { naam: vorig ? vorig.naam : naam, titel: publiek ? r.titel : (vorig ? vorig.titel : ''), publiek: publiek };
      run.pages[naam] = publiek ? 'publiek' : (r.oops ? 'Oops' : 'HTTP ' + r.status);
      if (volledig && publiek) {
        r.pages.forEach((n) => {
          const kk = n.toLowerCase();
          if (run.pagesGedaan.indexOf(kk) === -1 && !run.pagesRij.some((x) => x.toLowerCase() === kk)) run.pagesRij.push(n);
        });
      }
      await bewaar(run, werk);
    }
    if (run.fase === 'pages') {
      run.fase = 'social';
      await bewaar(run, werk);
    }

    // Fase 3b (0.2.0): nieuwe topics naar de intake van de socials. Een fout
    // hier houdt de sitemap nooit tegen.
    if (run.fase === 'social') {
      try {
        await socialIntake(ctx, run, werk, maxBekend);
      } catch (e) {
        log(run, 'Socials: ' + fout(e), false);
      }
    }
    run.fase = 'afronden';
    await bewaar(run, werk);

    // Fase 4: afronden
    await rondAf(run, werk, toestand, volledig, gezien);
  } catch (e) {
    if (ctx && ctx.run) {
      log(ctx.run, (e.venster ? 'Onderbroken: ' : 'Fout: ') + fout(e), false);
      await zet({ sm_run: ctx.run });
    } else {
      const o = await lees(['sm_run']);
      if (o.sm_run && !o.sm_run.klaar) {
        log(o.sm_run, 'Fout: ' + fout(e), false);
        await zet({ sm_run: o.sm_run });
      }
    }
    const o = await lees(['sm_run']);
    if (o.sm_run && !o.sm_run.klaar && (o.sm_run.hervattingen || 0) >= MAX_HERVATTINGEN) {
      // Opgeven tot het volgende geplande uur: de run telt als afgesloten, de
      // officiële toestand blijft ongewijzigd, morgen begint een nieuwe run.
      const run = o.sm_run;
      run.klaar = true;
      run.opgegeven = true;
      run.einde = Date.now();
      run.publicatie = 'opgegeven na ' + MAX_HERVATTINGEN + ' hervattingen; niets veranderd';
      log(run, 'Opgegeven. De vorige sitemap blijft staan.', false);
      await zet({ sm_run: run, sm_werk: null, sm_verslag: run, sm_laatste_run: Date.now() });
      await meld('Sitemap: run opgegeven', 'Na ' + MAX_HERVATTINGEN + ' hervattingen gestopt: ' + fout(e) + '. De vorige sitemap blijft staan; morgen opnieuw.');
    }
  } finally {
    if (ctx && ctx.vensterId !== undefined) {
      try { await chrome.windows.remove(ctx.vensterId); } catch (e) { /* al dicht */ }
    }
    await zet({ sm_slot: null });
    bezig = false;
  }
}

// Eén board: pagina 1, 2, ... Volledig: tot er geen nieuwe threads meer komen.
// Dagelijks: tot een pagina waarop niets nieuw of gewijzigd is.
async function crawlBoard(ctx, id, werk, gezien, volledig, vandaag, maxBekend) {
  const b = werk.boards[id] || (werk.boards[id] = { naam: '', pad: '/board/' + id, kruimel: [], publiek: false, paginas: 0 });
  const res = { ok: true, naam: b.naam, gelezen: 0, nieuw: 0, gewijzigd: 0, tekst: '' };
  const r1 = await haal(ctx, '/board/' + id, id);
  if (!r1 || r1.status === 0 || r1.status === 202 || r1.status >= 500) {
    res.ok = false;
    res.tekst = 'niet gelezen (' + (r1 ? (r1.fout || 'HTTP ' + r1.status) : 'geen antwoord') + '); vorige gegevens blijven staan.';
    return res;
  }
  if (r1.status !== 200 || r1.oops) {
    b.publiek = false;
    res.tekst = 'niet publiek (' + (r1.oops ? 'Oops' : 'HTTP ' + r1.status) + ').';
    return res;
  }
  b.publiek = true;
  if (r1.titel) b.naam = r1.titel;
  res.naam = b.naam;
  if (r1.kruimel.length) b.kruimel = r1.kruimel;
  r1.boards.forEach((x) => {
    const w = werk.boards[x[0]] || (werk.boards[x[0]] = { naam: '', pad: '/board/' + x[0], kruimel: [], publiek: false, paginas: 0 });
    if (x[1].length > (w.pad || '').length) w.pad = x[1];
    if (ctx.run.gedaan.indexOf(x[0]) === -1 && ctx.run.mislukt.indexOf(x[0]) === -1 && ctx.run.wachtrij.indexOf(x[0]) === -1) ctx.run.wachtrij.push(x[0]);
  });
  r1.pages.forEach((n) => {
    if (!werk.pages[n.toLowerCase()] && !ctx.run.pagesRij.some((x) => x.toLowerCase() === n.toLowerCase())) ctx.run.pagesRij.push(n);
  });

  const verwerk = (rijen) => {
    let nieuwInRun = 0;
    let veranderd = 0;
    rijen.forEach((rij) => {
      const echtNieuw = maxBekend !== null && Number(rij.id) > maxBekend;
      const uit = K.pasRijToe(werk.threads, rij, id, vandaag, echtNieuw);
      if (uit === 'nieuw') { res.nieuw++; ctx.run.tellers.nieuw++; veranderd++; }
      if (uit === 'gewijzigd') { res.gewijzigd++; ctx.run.tellers.gewijzigd++; veranderd++; }
      if (!gezien.has(rij.id)) { gezien.add(rij.id); nieuwInRun++; }
    });
    return { nieuwInRun: nieuwInRun, veranderd: veranderd };
  };

  res.gelezen = 1;
  ctx.run.tellers.boardpaginas++;
  let v = verwerk(r1.rijen);
  let laatste = r1.rijen.length ? 1 : 0;
  const basis = '/board/' + id;
  let doorgaan = r1.rijen.length > 0 && (volledig || v.veranderd > 0);
  for (let p = 2; doorgaan && p <= MAX_PAGINAS_PER_BOARD; p++) {
    const r = await haal(ctx, basis + '?page=' + p, id);
    if (!r || r.status !== 200) {
      res.ok = false;
      res.tekst = 'pagina ' + p + ' niet gelezen (' + (r ? (r.fout || 'HTTP ' + r.status) : 'geen antwoord') + ').';
      break;
    }
    res.gelezen++;
    ctx.run.tellers.boardpaginas++;
    if (!r.rijen.length) break;
    v = verwerk(r.rijen);
    if (v.nieuwInRun === 0) break;          // ProBoards geeft voorbij de laatste pagina opnieuw de laatste
    laatste = p;
    doorgaan = volledig || v.veranderd > 0;
  }
  if (volledig && res.ok) b.paginas = laatste;
  else b.paginas = Math.max(b.paginas || 0, laatste, r1.laatstePagina || 0);
  if (res.ok) {
    res.tekst = res.gelezen + ' pagina(s) gelezen, ' + res.nieuw + ' nieuw, ' + res.gewijzigd + ' gewijzigd; ' + b.paginas + ' pagina(s) in totaal.';
  }
  return res;
}

async function rondAf(run, werk, toestandVoor, volledig, gezien) {
  // Bij een volledige crawl zonder mislukte boards: threads die nergens meer
  // staan, zijn verwijderd of niet meer publiek.
  let verwijderd = 0;
  if (volledig && !run.mislukt.length) {
    Object.keys(werk.threads).forEach((id) => {
      if (!gezien.has(id)) { delete werk.threads[id]; verwijderd++; }
    });
    werk.laatsteVolledig = run.datum;
  }
  run.tellers.verwijderd = verwijderd;
  werk.laatsteRun = new Date().toISOString();

  const x = K.bouwXml(werk);
  const data = K.bouwData(werk);
  const dataTekst = JSON.stringify(data, null, 1) + '\n';
  const stateTekst = JSON.stringify(werk) + '\n';
  run.uitvoer = { aantal: x.aantal, telling: x.telling, xmlBytes: new TextEncoder().encode(x.xml).length };
  log(run, 'Sitemap gebouwd: ' + x.aantal + ' URL\'s (' + x.telling.metLastmod + ' met lastmod).', true);

  const o = await lees(['sm_vorig_aantal', 'sm_droog', 'sm_pat']);
  const droog = o.sm_droog !== false;
  const vorig = o.sm_vorig_aantal || 0;
  let krimp = false;
  if (vorig && x.aantal < vorig * KRIMP_GRENS) {
    krimp = true;
    log(run, 'Te sterke krimp: ' + x.aantal + ' tegenover ' + vorig + ' de vorige keer. Niet gepubliceerd en niet bewaard.', false);
    await meld('Sitemap niet gepubliceerd', 'Slechts ' + x.aantal + ' URL\'s tegenover ' + vorig + ' de vorige keer. Zie het verslag.');
  }

  let publicatie = droog ? 'droge stand: niets gepubliceerd' : '';
  if (!krimp) {
    // De nieuwe toestand wordt pas nu de officiële.
    await zet({ sm_state: werk, sm_xml: x.xml, sm_data: dataTekst, sm_state_tekst: stateTekst, sm_vorig_aantal: x.aantal });
    if (!droog) {
      if (!o.sm_pat) {
        publicatie = 'niet gepubliceerd: geen GitHub-token ingesteld';
        log(run, publicatie + '.', false);
        await meld('Sitemap niet gepubliceerd', 'Er is geen GitHub-token ingesteld (opties van de extensie).');
      } else {
        try {
          const p = await publiceer({ 'sitemap.xml': x.xml, 'sitemap-data.json': dataTekst, 'sitemap-state.json': stateTekst },
            'Sitemap ' + run.datum + ' (' + run.soort + '): ' + x.aantal + ' URL\'s', o.sm_pat);
          publicatie = p.gewijzigd ? 'gepubliceerd, commit ' + p.commit.slice(0, 7) : 'niets veranderd, geen commit';
          log(run, 'GitHub: ' + publicatie + '.', true);
        } catch (e) {
          publicatie = 'publiceren mislukt: ' + fout(e);
          log(run, publicatie, false);
          await meld('Sitemap niet gepubliceerd', fout(e));
        }
      }
    } else {
      log(run, 'Droge stand: niets gepubliceerd. De bestanden staan klaar in het verslag.', true);
    }
  }

  run.publicatie = krimp ? 'niet gepubliceerd: te sterke krimp' : publicatie;
  run.klaar = true;
  run.einde = Date.now();
  run.onvolledig = run.mislukt.length > 0;
  if (run.onvolledig) {
    await meld('Sitemap onvolledig', run.mislukt.length + ' board(s) niet gelezen: ' + run.mislukt.join(', ') + '. Hun vorige gegevens blijven staan.');
  }
  await zet({ sm_run: run, sm_werk: null, sm_verslag: run, sm_laatste_run: run.start });
}

// ---------------------------------------------------------------------------
// Socials (0.2.0)
// ---------------------------------------------------------------------------

function hoogsteId(threads) {
  const ids = Object.keys(threads).map(Number);
  return ids.length ? Math.max.apply(null, ids) : null;
}

// Stuurt de openingspost van de echt nieuwe topics in één call naar de
// intake-route. "Echt nieuw" = hoger ID dan wat de vorige keer al doorgestuurd
// werd (sm_social_laatste), of bij de eerste keer: dan het hoogste gekende
// vóór deze run. Zo gaat er nooit een achterstand mee. Mislukt de call, dan
// blijft sm_social_laatste staan en komen dezelfde topics de volgende run
// opnieuw. Hoogstens SOCIAL_MAX_TOPICS per run; de rest volgt de volgende run.
async function socialIntake(ctx, run, werk, maxBekend) {
  const o = await lees(['sm_social_url', 'sm_social_key', 'sm_social_laatste']);
  run.social = { stand: '', verstuurd: 0, toegevoegd: 0, neurons: null, resultaten: [] };
  if (!o.sm_social_url || !o.sm_social_key) {
    run.social.stand = 'niet ingesteld (adres of sleutel ontbreekt in de opties)';
    log(run, 'Socials: niet ingesteld; overgeslagen.', null);
    return;
  }

  const basis = typeof o.sm_social_laatste === 'number' ? o.sm_social_laatste : maxBekend;
  const hoogste = hoogsteId(werk.threads);
  if (basis === null) {
    run.social.stand = 'eerste crawl: niets doorgestuurd';
    if (hoogste !== null) await zet({ sm_social_laatste: hoogste });
    log(run, 'Socials: eerste crawl, niets doorgestuurd.', null);
    return;
  }

  const nieuw = Object.keys(werk.threads).map(Number)
    .filter((id) => id > basis && SOCIAL_BOARDS_OVERSLAAN.indexOf(String(werk.threads[id].b)) === -1)
    .sort((a, b) => a - b);
  if (!nieuw.length) {
    run.social.stand = 'geen nieuwe topics';
    if (hoogste !== null && hoogste > basis) await zet({ sm_social_laatste: hoogste });
    log(run, 'Socials: geen nieuwe topics.', true);
    return;
  }

  const deze = nieuw.slice(0, SOCIAL_MAX_TOPICS);
  const laatsteVanDeze = deze[deze.length - 1];
  const topics = [];
  for (const id of deze) {
    const t = werk.threads[id];
    const r = await haal(ctx, '/thread/' + id, null, leesTopicInPagina);
    if (!r || r.status !== 200 || r.oops || r.tekst === null) {
      run.social.resultaten.push({ id: String(id), titel: (r && r.titel) || '', categorie: 'niet gelezen', socials: false, door: 'extensie',
        reden: r ? (r.fout || (r.oops ? 'Oops' : 'HTTP ' + r.status)) : 'geen antwoord' });
      continue;
    }
    topics.push({
      id: String(id), url: FORUM + t.p, board: String(t.b), titel: r.titel, tekst: r.tekst,
      domeinen: r.domeinen, poll: r.poll, jplmc: r.jplmc, auteur_id: r.auteur_id
    });
  }

  if (!topics.length) {
    run.social.stand = 'geen leesbare nieuwe topics';
    await zet({ sm_social_laatste: laatsteVanDeze });
    log(run, 'Socials: ' + deze.length + ' nieuw topic(s), geen enkel leesbaar.', false);
    return;
  }

  let res;
  let data = null;
  try {
    res = await fetch(o.sm_social_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': o.sm_social_key },
      body: JSON.stringify({ topics: topics }),
      cache: 'no-store'
    });
    try { data = await res.json(); } catch (e) { data = null; }
  } catch (e) {
    run.social.stand = 'intake niet bereikt: ' + fout(e);
    log(run, 'Socials: ' + run.social.stand + '. Volgende run opnieuw.', false);
    await meld('Socials: intake mislukt', run.social.stand);
    return;
  }
  if (!res.ok || !data) {
    run.social.stand = 'intake weigerde: HTTP ' + res.status + (data && data.error ? ' (' + data.error + ')' : '');
    log(run, 'Socials: ' + run.social.stand + '. Volgende run opnieuw.', false);
    await meld('Socials: intake mislukt', run.social.stand);
    return;
  }

  run.social.verstuurd = topics.length;
  run.social.toegevoegd = data.toegevoegd || 0;
  run.social.neurons = data.neurons_vandaag !== undefined ? data.neurons_vandaag + ' / ' + data.plafond : null;
  (data.resultaten || []).forEach((x) => {
    run.social.resultaten.push({ id: String(x.id), titel: x.titel || '', categorie: x.categorie || '', socials: x.socials === true, door: x.door || '', reden: x.reden || '' });
  });
  run.social.stand = topics.length + ' beoordeeld, ' + run.social.toegevoegd + ' naar de wachtrij' +
    (nieuw.length > deze.length ? '; ' + (nieuw.length - deze.length) + ' volgen de volgende run' : '');
  await zet({ sm_social_laatste: laatsteVanDeze });
  log(run, 'Socials: ' + run.social.stand + '.', true);
}

// Test vanuit de opties: een lege lijst kost niets en toont of adres en
// sleutel kloppen.
async function socialTest() {
  const o = await lees(['sm_social_url', 'sm_social_key']);
  if (!o.sm_social_url || !o.sm_social_key) return { ok: false, tekst: 'Adres of sleutel ontbreekt.' };
  const res = await fetch(o.sm_social_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': o.sm_social_key },
    body: JSON.stringify({ topics: [] }),
    cache: 'no-store'
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (res.ok && data && data.status === 'ok') {
    return { ok: true, tekst: 'Intake bereikbaar, sleutel aanvaard. Model: ' + data.model + '. AI vandaag: ' + data.neurons_vandaag + ' van ' + data.plafond + ' neurons.' };
  }
  return { ok: false, tekst: 'HTTP ' + res.status + (data && data.error ? ': ' + data.error : '') };
}

// ---------------------------------------------------------------------------
// GitHub (enkel REPO)
// ---------------------------------------------------------------------------

async function gh(pat, pad, methode, body) {
  const init = {
    method: methode || 'GET',
    headers: { 'Authorization': 'Bearer ' + pat, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store'
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch('https://api.github.com/repos/' + REPO + pad, init);
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) throw new Error('GitHub ' + (methode || 'GET') + ' ' + pad + ': HTTP ' + res.status + (data && data.message ? ' (' + data.message + ')' : ''));
  return data;
}

// Commit via de Git Data API (sitemap.xml is groter dan 1 MB). Enkel als
// sitemap.xml of sitemap-data.json echt veranderd is.
async function publiceer(bestanden, boodschap, pat) {
  const ref = await gh(pat, '/git/ref/heads/' + TAK);
  const basis = ref.object.sha;
  const commit = await gh(pat, '/git/commits/' + basis);
  const boom = await gh(pat, '/git/trees/' + commit.tree.sha);
  const bestaand = {};
  (boom.tree || []).forEach((e) => { if (e.type === 'blob') bestaand[e.path] = e.sha; });

  const shas = {};
  for (const pad of Object.keys(bestanden)) shas[pad] = await K.gitBlobSha(bestanden[pad]);
  const inhoudVeranderd = ['sitemap.xml', 'sitemap-data.json'].some((p) => bestanden[p] !== undefined && bestaand[p] !== shas[p]);
  if (!inhoudVeranderd) return { gewijzigd: false };

  const wijzigingen = [];
  for (const pad of Object.keys(bestanden)) {
    if (bestaand[pad] === shas[pad]) continue;
    const blob = await gh(pat, '/git/blobs', 'POST', { content: bestanden[pad], encoding: 'utf-8' });
    wijzigingen.push({ path: pad, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const nieuweBoom = await gh(pat, '/git/trees', 'POST', { base_tree: commit.tree.sha, tree: wijzigingen });
  const nieuweCommit = await gh(pat, '/git/commits', 'POST', { message: boodschap, tree: nieuweBoom.sha, parents: [basis] });
  await gh(pat, '/git/refs/heads/' + TAK, 'PATCH', { sha: nieuweCommit.sha });
  return { gewijzigd: true, commit: nieuweCommit.sha, bestanden: wijzigingen.map((w) => w.path) };
}

async function githubTest() {
  const o = await lees(['sm_pat']);
  if (!o.sm_pat) return { ok: false, tekst: 'Geen token ingesteld.' };
  const repo = await gh(o.sm_pat, '');
  const push = repo.permissions ? repo.permissions.push : null;
  return {
    ok: push !== false,
    tekst: 'Repo ' + repo.full_name + ' bereikbaar (' + (repo.private ? 'privé' : 'publiek') + '). Schrijfrecht: ' + (push === null ? 'onbekend' : (push ? 'ja' : 'nee')) + '.'
  };
}
