# voetbalBE-Sitemap

XML-sitemap van voetbalbe.boards.net, geserveerd via GitHub Pages. Google leest hem via de Cloudflare Worker `voetbalbe-sitemap` (zie "Google Search Console").

## Bestanden

| Bestand | Inhoud |
|---|---|
| `sitemap.xml` | De sitemap volgens het sitemaps.org-protocol (0.9). Ingediend in Google Search Console via de Worker, niet via dit adres. |
| `.nojekyll` | Zet de Jekyll-verwerking van GitHub Pages uit. Bestanden worden ongewijzigd geserveerd, en de bekende transiënte buildfouten van Jekyll vallen weg. |
| `index.html` | Startpagina van dit adres, met een link naar de sitemap. Staat op `noindex`. Nodig omdat GitHub Pages zonder Jekyll geen startpagina uit de README maakt; zonder dit bestand gaf het hoofdadres 404. |
| `extensie/` | Broncode van de Chrome-extensie "VoetbalBE Sitemap" die de bestanden hieronder maakt en publiceert. Bevat geen sleutels. |

Zodra de extensie publiceert, schrijft ze ook:

| Bestand | Inhoud |
|---|---|
| `sitemap-data.json` | De structuur voor de latere custom page `/page/sitemap`: publieke boards (naam, pad, ouder, aantal threads en pagina's, laatste wijziging) en publieke custom pages. |
| `sitemap-state.json` | De toestand van de crawl: per thread de reactieteller en de lastmod-datums per pagina. Dient als reservekopie, zodat de datums een herinstallatie overleven. |

## Google Search Console

Google leest de sitemap op `https://voetbalbe-sitemap.matchcenter-bot.workers.dev/sitemap.xml`. Die Worker (v2.0) is enkel een proxy: hij geeft `sitemap.xml` van dit adres byte voor byte door als `application/xml`, en serveert daarnaast een `robots.txt` met een Sitemap-regel en het verificatiebestand voor de URL-prefix-property van zijn eigen adres. Al de rest geeft 404. Is dit adres onbereikbaar, dan antwoordt hij 503.

Waarom niet rechtstreeks: op 17 november 2026 werd de sitemap ingediend in een property voor dit github.io-adres. Google haalde hem nooit op ("Kan niet ophalen", geen datum bij "Laatst gelezen"), en dat gold ook voor een testbestand met één URL op dit adres zelf. Hetzelfde bestand via de Worker werd dezelfde dag gelezen: status Succesvol, 16.544 ontdekte pagina's. Het probleem was dus de host GitHub Pages, niet de inhoud. De property voor dit adres is op 18 november 2026 verwijderd.

Dat de URL's op een ander domein staan dan de sitemap, is geen probleem: de properties van voetbalbe.boards.net en van de Worker zijn geverifieerd in hetzelfde account.

## De extensie

Chrome-extensie (Manifest V3), uitgepakt geladen op de computer van de beheerder.

**Wanneer.** Dagelijks om 09:00 (Brussel) via een timer in Chrome. Is dat uur gemist (computer uit of in slaap), dan draait de run bij het opstarten van Chrome of bij het eerstvolgende bezoek aan het forum. Op zondag, of als de vorige volledige crawl 7 dagen of langer geleden is, volgt een volledige crawl; anders enkel wat veranderd is.

**Hoe.** De extensie opent een geminimaliseerd venster op het forum en leest daarin alle pagina's met verzoeken zonder cookies, dus in gastweergave. Het venster zelf laadt de homepage zoals een gewoon bezoek; de crawl doet dat niet. Gele bollen en ongelezen-markeringen van de beheerder blijven daardoor staan. Tussen twee verzoeken zit 0,8 s.

- Dagelijks: per board pagina 1, 2, … tot een pagina waarop niets nieuw of gewijzigd is (ongeveer 30 à 40 verzoeken).
- Volledig: alle pagina's van alle boards en alle custom pages (ongeveer 330 verzoeken, 8 minuten). Verwijderde threads verdwijnen enkel uit de toestand als de volledige crawl zonder mislukte boards eindigt.

**Wat erin komt.** De homepage, alle publieke boards met al hun pagina's, alle threads met al hun pagina's (20 posts per pagina, berekend uit de reactieteller) en alle custom pages die een gast zonder fout te zien krijgt. Gevonden via links en broncode, plus een vaste lijst (boards en de pages Matchcenter en games). Wat een gast niet ziet (Oops, login), komt er niet in. Geen `<priority>`: Google negeert die.

**lastmod.** De eerste crawl geeft geen datums. Daarna krijgt een pagina de datum van de dag waarop een run ziet dat ze veranderd is: stijgt de reactieteller van een thread, dan krijgen de laatste pagina en de nieuwe pagina's die datum (een volle laatste pagina verandert zelf niet). Een thread die nog niet gekend was, krijgt enkel een datum als zijn ID hoger is dan het hoogste gekende (echt nieuw); een eerder gemiste oudere thread krijgt er geen. Boards en de homepage krijgen de jongste datum van hun threads.

**Vangnetten.**
- Tot 3 nieuwe pogingen bij een netwerkfout, HTTP 202 of 5xx (na 5, 10 en 20 s).
- Een board dat niet gelezen kan worden, houdt zijn vorige gegevens; de run heet dan onvolledig en er volgt een melding.
- Een run die onderbroken wordt (venster gesloten, computer uit), gaat bij de volgende gelegenheid verder waar hij was. Na 3 hervattingen geeft hij op tot het volgende geplande uur; de vorige sitemap blijft dan staan.
- Telt de nieuwe sitemap minder dan 90% van de URL's van de vorige, dan wordt hij niet gepubliceerd en niet bewaard, met een melding.
- Gepubliceerd wordt via de Git Data API, en enkel als `sitemap.xml` of `sitemap-data.json` echt veranderd is.
- De droge stand staat standaard aan: dan wordt alles gebouwd maar niets gepubliceerd; de bestanden zijn te downloaden op de verslagpagina.

**Token.** Een fine-grained GitHub-token met enkel toegang tot deze repo (Contents: lezen en schrijven). Staat enkel in de lokale opslag van de extensie, wordt nooit getoond of in een verslag gezet, en gaat enkel naar api.github.com. De extensie schrijft enkel naar deze repo.

**Bestanden.** `manifest.json`, `background.js` (planning, crawl, publiceren), `kern.js` (datums, lastmod-regels, XML en JSON bouwen; zonder Chrome-API's), `inhoud.js` (meldt een paginabezoek), `opties.html/.js` (token, droge stand, gegevens wissen), `verslag.html/.js` (laatste run, downloads, knoppen om nu te draaien), twee iconen.

## Stand

**17 november 2026 — testversie.** `sitemap.xml` bevat enkel de homepage, de 23 publieke boards en de 30 publieke custom pages (54 URL's), zonder lastmod. Doel: nagaan of Google Search Console een sitemap aanvaardt die op dit adres staat en URL's van voetbalbe.boards.net bevat (cross-submission, beide properties geverifieerd in hetzelfde account).

**17 november 2026 — extensie 0.1.0** in de map `extensie/`, nog in de droge stand. Getest in een simulatie (echte `background.js` en `kern.js` tegen een nagebootst forum en nagebootste Chrome- en GitHub-API's): eerste volledige crawl, dagelijkse run met wijzigingen, publiceren en niet opnieuw publiceren zonder wijzigingen, zondagse volledige crawl met verwijderde en eerder gemiste threads, een blijvend falend board, een onderbroken en hervatte run, opgeven na 3 hervattingen, en de krimpgrens.

**17 november 2026 — eerste echte run** van de extensie: 16.544 URL's gepubliceerd.

**18 november 2026 — via de Worker gelezen** door Google Search Console (zie hierboven). Verwijderd: de testbestanden `sitemap-forum.xml` en `sitemap-host-test.xml`, en het verificatiebestand van de opgeheven github.io-property.

## Afspraken

- De inhoud wordt gemaakt door een crawl in gastweergave (verzoeken zonder cookies): enkel wat een bezoeker zonder account te zien krijgt, komt in de sitemap.
- Deze repo bevat enkel uitvoer en de broncode van de extensie. Geen sleutels, tokens of persoonlijke gegevens.
