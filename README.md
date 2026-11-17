# voetbalBE-Sitemap

XML-sitemap van voetbalbe.boards.net, geserveerd via GitHub Pages.

## Bestanden

| Bestand | Inhoud |
|---|---|
| `sitemap.xml` | De sitemap volgens het sitemaps.org-protocol (0.9). Wordt ingediend in Google Search Console. |
| `.nojekyll` | Zet de Jekyll-verwerking van GitHub Pages uit. Bestanden worden ongewijzigd geserveerd, en de bekende transiënte buildfouten van Jekyll vallen weg. |

Later komt erbij: `sitemap-data.json`, een kleine samenvatting (boards, custom pages, aantallen) voor de custom page `/page/sitemap`.

## Stand

**17 november 2026 — testversie.** `sitemap.xml` bevat enkel de homepage, de 23 publieke boards en de 30 publieke custom pages (54 URL's), zonder lastmod. Doel: nagaan of Google Search Console een sitemap aanvaardt die op dit adres staat en URL's van voetbalbe.boards.net bevat (cross-submission, beide properties geverifieerd in hetzelfde account).

## Afspraken

- De inhoud wordt gemaakt door een crawl in gastweergave (verzoeken zonder cookies): enkel wat een bezoeker zonder account te zien krijgt, komt in de sitemap.
- Deze repo bevat enkel uitvoer. Geen sleutels, tokens of persoonlijke gegevens.
