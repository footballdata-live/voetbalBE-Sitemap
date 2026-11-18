// VoetbalBE Sitemap - verslag.js
// Alles wordt met textContent opgebouwd: boardnamen en titels komen van het forum.

const $ = (id) => document.getElementById(id);

function el(tag, tekst, klasse) {
  const e = document.createElement(tag);
  if (tekst !== undefined && tekst !== null) e.textContent = String(tekst);
  if (klasse) e.className = klasse;
  return e;
}

function tijd(ms) {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function duur(a, b) {
  if (!a || !b) return '-';
  const s = Math.round((b - a) / 1000);
  return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
}

function tabel(koppen, rijen, getallen) {
  const t = el('table');
  const kop = el('tr');
  koppen.forEach((k) => kop.appendChild(el('th', k)));
  t.appendChild(kop);
  rijen.forEach((r) => {
    const tr = el('tr');
    r.forEach((c, i) => {
      const td = el('td', c && c.tekst !== undefined ? c.tekst : c, (getallen && getallen.indexOf(i) !== -1 ? 'getal ' : '') + (c && c.klasse ? c.klasse : ''));
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  return t;
}

async function toon() {
  const o = await chrome.storage.local.get(['sm_run', 'sm_slot', 'sm_verslag', 'sm_droog']);
  const run = o.sm_run;
  const loopt = !!(o.sm_slot && run && !run.klaar);
  const v = loopt ? run : (o.sm_verslag || run);

  const stand = $('stand');
  if (loopt) {
    stand.className = 'band loopt';
    stand.textContent = 'Er loopt een run (' + run.soort + ', fase ' + run.fase + '): ' + run.gedaan.length + ' boards klaar, ' +
      run.wachtrij.length + ' te gaan, ' + run.tellers.verzoeken + ' verzoeken.';
  } else if (!v) {
    stand.className = 'band';
    stand.textContent = 'Nog geen run gedaan.';
  } else if (v.klaar && !v.opgegeven && !v.onvolledig) {
    stand.className = 'band ok';
    stand.textContent = 'Laatste run geslaagd: ' + tijd(v.einde) + '. ' + (v.publicatie || '');
  } else {
    stand.className = 'band nok';
    stand.textContent = v.klaar ? ('Laatste run ' + (v.opgegeven ? 'opgegeven' : 'onvolledig') + ': ' + tijd(v.einde) + '. ' + (v.publicatie || '')) :
      'Laatste run onderbroken; hij gaat verder bij de volgende gelegenheid.';
  }
  $('nuDagelijks').disabled = loopt;
  $('nuVolledig').disabled = loopt;

  try {
    const w = await chrome.runtime.sendMessage({ type: 'wekker' });
    $('volgende').textContent = 'Droge stand: ' + (o.sm_droog !== false ? 'aan' : 'uit') + '. Volgende geplande run: ' + (w && w.wanneer ? tijd(w.wanneer) : 'onbekend') + '.';
  } catch (e) { $('volgende').textContent = ''; }

  const s = $('samenvatting');
  s.textContent = '';
  if (!v) return;
  const tel = v.tellers || {};
  const u = v.uitvoer || { telling: {} };
  const rijen = [
    ['Soort', v.soort + ' (' + v.bron + ')'],
    ['Start / einde', tijd(v.start) + ' / ' + tijd(v.einde)],
    ['Duur', duur(v.start, v.einde || Date.now())],
    ['Verzoeken (waarvan herpogingen, HTTP 202)', (tel.verzoeken || 0) + ' (' + (tel.herpogingen || 0) + ', ' + (tel.pow || 0) + ')'],
    ['Boardpagina\'s gelezen', tel.boardpaginas || 0],
    ['Threads nieuw / gewijzigd / verwijderd', (tel.nieuw || 0) + ' / ' + (tel.gewijzigd || 0) + ' / ' + (tel.verwijderd || 0)],
    ['Mislukte boards', v.mislukt && v.mislukt.length ? v.mislukt.join(', ') : 'geen'],
    ['URL\'s in de sitemap', u.aantal !== undefined ? u.aantal : '-'],
    ['  homepage / boards / boardpagina\'s', (u.telling.home || 0) + ' / ' + (u.telling.boards || 0) + ' / ' + (u.telling.boardpaginas || 0)],
    ['  custom pages', u.telling.pages || 0],
    ['  threads / threadpagina\'s', (u.telling.threads || 0) + ' / ' + (u.telling.threadpaginas || 0)],
    ['  met lastmod', u.telling.metLastmod || 0],
    ['Grootte sitemap.xml', u.xmlBytes ? Math.round(u.xmlBytes / 1024) + ' KB' : '-'],
    ['Publicatie', v.publicatie || '-']
  ];
  s.appendChild(tabel(['', ''], rijen));

  const b = $('boards');
  b.textContent = '';
  const bRijen = Object.keys(v.boards || {}).sort((x, y) => Number(x) - Number(y)).map((id) => {
    const r = v.boards[id];
    return [id, r.naam || '', { tekst: r.ok ? 'ok' : 'mislukt', klasse: r.ok ? 'goed' : 'fout' }, r.gelezen || 0, r.nieuw || 0, r.gewijzigd || 0, r.tekst || ''];
  });
  b.appendChild(tabel(['ID', 'Naam', 'Stand', 'Gelezen', 'Nieuw', 'Gewijzigd', 'Toelichting'], bRijen, [3, 4, 5]));

  const p = $('pages');
  p.textContent = '';
  const pRijen = Object.keys(v.pages || {}).sort((x, y) => x.toLowerCase() < y.toLowerCase() ? -1 : 1).map((n) => [n, { tekst: v.pages[n], klasse: v.pages[n] === 'publiek' ? 'goed' : '' }]);
  p.appendChild(pRijen.length ? tabel(['Page', 'Stand'], pRijen) : el('p', 'Geen custom pages gelezen in deze run.', 'uitleg'));

  const so = $('social');
  so.textContent = '';
  const sv = v.social;
  if (!sv) {
    so.appendChild(el('p', 'Geen gegevens in deze run.', 'uitleg'));
  } else {
    so.appendChild(el('p', 'Stand: ' + (sv.stand || '-') + (sv.neurons ? ' · AI vandaag: ' + sv.neurons + ' neurons' : ''), 'uitleg'));
    if (sv.resultaten && sv.resultaten.length) {
      const sRijen = sv.resultaten.map((x) => [x.id, x.titel, x.categorie, { tekst: x.socials ? 'ja' : 'nee', klasse: x.socials ? 'goed' : '' }, x.door, x.reden]);
      so.appendChild(tabel(['ID', 'Titel', 'Categorie', 'Socials', 'Door', 'Reden'], sRijen));
    }
  }

  const l = $('log');
  l.textContent = '';
  (v.log || []).forEach((r) => {
    const li = el('li', '[' + r.s + ' s] ' + r.tekst, r.ok === true ? 'goed' : r.ok === false ? 'fout' : '');
    l.appendChild(li);
  });
}

document.querySelectorAll('button[data-sleutel]').forEach((knop) => {
  knop.addEventListener('click', async () => {
    const o = await chrome.storage.local.get([knop.dataset.sleutel]);
    const inhoud = o[knop.dataset.sleutel];
    if (!inhoud) { alert('Nog niet beschikbaar: eerst een run laten lopen.'); return; }
    const url = URL.createObjectURL(new Blob([inhoud], { type: knop.dataset.type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = knop.dataset.naam;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
});

$('nuDagelijks').addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'nu', soort: 'dagelijks' }); setTimeout(toon, 800); });
$('nuVolledig').addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'nu', soort: 'volledig' }); setTimeout(toon, 800); });

chrome.storage.onChanged.addListener((wijz, gebied) => {
  if (gebied === 'local' && (wijz.sm_run || wijz.sm_verslag || wijz.sm_slot)) toon();
});

toon();
