// VoetbalBE Sitemap - inhoud.js
// Meldt een paginabezoek op het forum, zodat een gemiste run van 09:00
// ingehaald wordt. Leest of verandert niets op de pagina.
try {
  chrome.runtime.sendMessage({ type: 'paginabezoek' });
} catch (e) { /* extensie net herladen */ }
