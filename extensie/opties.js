// VoetbalBE Sitemap - opties.js
// De token wordt nooit teruggetoond: enkel of hij ingesteld is.

const $ = (id) => document.getElementById(id);

function toon(el, tekst, ok) {
  el.hidden = false;
  el.textContent = tekst;
  el.className = 'melding ' + (ok === true ? 'ok' : ok === false ? 'nok' : '');
}

async function laad() {
  const o = await chrome.storage.local.get(['sm_droog', 'sm_pat', 'sm_social_url', 'sm_social_key']);
  $('droog').checked = o.sm_droog !== false;
  toon($('tokenstand'), o.sm_pat ? 'Er is een token ingesteld.' : 'Er is nog geen token ingesteld.', !!o.sm_pat);
  const klaar = !!(o.sm_social_url && o.sm_social_key);
  toon($('socialstand'), klaar ? 'Adres en sleutel zijn ingesteld.' :
    (o.sm_social_url ? 'Adres ingesteld, sleutel ontbreekt.' : o.sm_social_key ? 'Sleutel ingesteld, adres ontbreekt.' : 'Nog niet ingesteld: deze stap wordt overgeslagen.'), klaar);
  if (o.sm_social_url && !$('socialUrl').value) $('socialUrl').value = o.sm_social_url;
}

$('bewaarSocial').addEventListener('click', async () => {
  const url = $('socialUrl').value.trim();
  const sleutel = $('socialKey').value.trim();
  if (url && !/^https:\/\/[^\s]+\/intake$/.test(url)) { toon($('socialmelding'), 'Het adres moet met https:// beginnen en op /intake eindigen.', false); return; }
  const nieuw = {};
  if (url) nieuw.sm_social_url = url;
  if (sleutel) nieuw.sm_social_key = sleutel;
  if (!Object.keys(nieuw).length) { toon($('socialmelding'), 'Vul een adres of een sleutel in.', false); return; }
  await chrome.storage.local.set(nieuw);
  $('socialKey').value = '';
  toon($('socialmelding'), 'Bewaard.', true);
  laad();
});

$('testSocial').addEventListener('click', async () => {
  toon($('socialmelding'), 'Bezig…', null);
  const r = await chrome.runtime.sendMessage({ type: 'social_test' });
  toon($('socialmelding'), r ? r.tekst : 'Geen antwoord.', r ? r.ok : false);
});

$('wisSocial').addEventListener('click', async () => {
  await chrome.storage.local.remove(['sm_social_url', 'sm_social_key']);
  $('socialUrl').value = '';
  toon($('socialmelding'), 'Adres en sleutel gewist.', true);
  laad();
});

$('droog').addEventListener('change', async () => {
  await chrome.storage.local.set({ sm_droog: $('droog').checked });
});

$('bewaarToken').addEventListener('click', async () => {
  const t = $('token').value.trim();
  if (!t) { toon($('tokenmelding'), 'Plak eerst een token.', false); return; }
  await chrome.storage.local.set({ sm_pat: t });
  $('token').value = '';
  toon($('tokenmelding'), 'Token bewaard.', true);
  laad();
});

$('testToken').addEventListener('click', async () => {
  toon($('tokenmelding'), 'Bezig…', null);
  const r = await chrome.runtime.sendMessage({ type: 'github_test' });
  toon($('tokenmelding'), r ? r.tekst : 'Geen antwoord.', r ? r.ok : false);
});

$('wisToken').addEventListener('click', async () => {
  await chrome.storage.local.remove('sm_pat');
  toon($('tokenmelding'), 'Token gewist.', true);
  laad();
});

$('wisGegevens').addEventListener('click', async () => {
  if (!confirm('Alle sitemapgegevens wissen? De volgende run wordt een volledige crawl.')) return;
  await chrome.storage.local.remove(['sm_state', 'sm_werk', 'sm_run', 'sm_xml', 'sm_data', 'sm_state_tekst', 'sm_vorig_aantal', 'sm_laatste_run', 'sm_verslag', 'sm_slot']);
  toon($('gegevensmelding'), 'Gewist.', true);
});

laad();
