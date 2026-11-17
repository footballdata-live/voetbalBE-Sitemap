# voetbalBE-Sitemap

XML-sitemap van voetbalbe.boards.net, geserveerd via GitHub Pages.

## Bestanden

| Bestand | Inhoud |
|---|---|
| `sitemap.xml` | De sitemap volgens het sitemaps.org-protocol (0.9). Wordt ingediend in Google Search Console. |
| `.nojekyll` | Zet de Jekyll-verwerking van GitHub Pages uit. Bestanden worden ongewijzigd geserveerd, en de bekende transiënte buildfouten van Jekyll vallen weg. |
| `index.html` | Startpagina van dit adres, met een link naar de sitemap. Staat op `noindex`. Nodig omdat GitHub Pages zonder Jekyll geen startpagina uit de README maakt; zonder dit bestand gaf het hoofdadres 404. |
| `googlea0b48e136cb9b0a2.html` | Verificatiebestand van Google Search Console voor de URL-prefix-property van dit adres. Niet wijzigen of verwijderen. |

Later komt erbij: `sitemap-data.json`, een kleine samenvatting (boards, custom pages, aantallen) voor de custom page `/page/sitemap`.

## Stand

**17 november 2026 — testversie.** `sitemap.xml` bevat enkel de homepage, de 23 publieke boards en de 30 publieke custom pages (54 URL's), zonder lastmod. Doel: nagaan of Google Search Console een sitemap aanvaardt die op dit adres staat en URL's van voetbalbe.boards.net bevat (cross-submission, beide properties geverifieerd in hetzelfde account).

Tijdelijke testbestanden, te verwijderen na de test:
- `sitemap-forum.xml`: identieke kopie van `sitemap.xml` onder een nieuwe naam, om een eerder bewaard foutresultaat in GSC te omzeilen.
- `sitemap-host-test.xml`: één URL op dit adres zelf. Wordt deze wel gelezen en `sitemap-forum.xml` niet, dan weigert GSC de URL's van het andere domein.

## Afspraken

- De inhoud wordt gemaakt door een crawl in gastweergave (verzoeken zonder cookies): enkel wat een bezoeker zonder account te zien krijgt, komt in de sitemap.
- Deze repo bevat enkel uitvoer. Geen sleutels, tokens of persoonlijke gegevens.
