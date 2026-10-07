# Fund portfolio-page scrape notes

Method: WebFetch (HTTP GET, HTML to markdown, no JS execution). "Static HTML" below means the company cards were present in the served HTML; "JS-only" means the served HTML had no company data. Counts are rows written to funds.csv (deduped per fund on company name). Where a page is paginated or truncated by the fetch tool, the count is what was recoverable, and the note says so.

Legend for scraper hints: LOC = per-company HQ/country shown on the list page; LOC-FILTER = list page exposes a location/country filter; DOM = company website domain shown/linked on the list page.

| Fund | Rows | Readability | URL that worked | Location data / scraper notes |
|---|---|---|---|---|
| 20VC | 0 | FAILED | 20vc.com -> thetwentyminutevc.com (media site); 20vc.fund homepage has no listing; /portfolio 404 | No public portfolio page found. Skip or use Crunchbase. |
| Visionaries Club | 24 | Static HTML (list truncated by fetch tool; site likely has more) | https://www.visionaries.vc/portfolio | DOM yes. Some cities shown in descriptions. No location filter. Re-scrape with a full HTML parser to get the complete list. |
| Next47 | 58 | Static HTML | https://www.n47.com/portfolio (next47.com redirects) | Region tag per company (US/Europe/Israel), stage per company. No domains, no city. Region filter likely present. |
| Frontline Ventures | 43 | Static HTML | https://www.frontline.vc/portfolio | Descriptions only; no domains, no HQ, no filter. |
| Episode 1 | 84 | Static HTML (complete, with links) | https://episode1.com/portfolio | DOM yes (external links), sector tags, stage tags. No HQ (all UK-centric). No location filter. Best-quality seed page. |
| Ada Ventures | 53 | Static HTML (single-page site, anchor section) | https://www.adaventures.com/#our-portfolio (/portfolio 404) | Focus area + stage + fund tags per company. No domains, no HQ. |
| Concept Ventures | 34 | Static HTML | https://concept.vc/portfolio (conceptventures.vc redirects) | DOM yes, HQ city shown for some, graduated/year tags. No filter. |
| Air Street Capital | 66 | Static HTML (complete) | https://www.airstreet.com/portfolio | DOM yes, country code per company (UK/USA/FR/DE...), stage, grouped by fund epoch. No filter but LOC is trivially parseable. |
| Passion Capital | 112 | Static HTML (names only) | https://passioncapital.com/fund-portfolio/ (/portfolio 404) | Names + logos only. No domains, HQ, sector or stage. |
| Fuel Ventures | 185 | Static HTML, server-side paginated | https://fuel.ventures/portfolio?page=1..4 | DOM yes, sector, stage (SEIS/EIS). No HQ. Pagination via ?page=N (4 pages). |
| Kindred Capital | 71 | Static HTML (some JS filter UI) | https://kindredcapital.vc/portfolio | DOM yes, sector, year, status (Active/Exited). No HQ. Sector/status filters. |
| Connect Ventures | 30 | Static HTML | https://www.connectventures.co/companies | LOC yes (country per company), sector, year, status. LOC-FILTER yes (location/sector/status/year). No domains. |
| Mosaic Ventures | 53 | Static HTML | https://www.mosaicventures.com/portfolio | DOM yes, sector, status. No HQ. |
| Stride.VC | 20 | Static HTML (homepage section) | https://stride.vc/ (/portfolio 404) | Names + logos only. No metadata. |
| Form Ventures | 0 | FAILED | formventures.com redirects to an unrelated WordPress consultancy blog | Domain no longer belongs to the VC. Skip. |
| Fly Ventures | 5 | Static HTML (featured only) | https://fly.vc/portfolio | Only 5 featured companies with DOM, HQ, stage. Full list probably elsewhere or JS. |
| Ascension | 146 | Static HTML (logo grid) | https://www.ascension.vc/portfolio | Names only; sector and vintage filters; Exited tag on some. No domains, no HQ, no location filter. |
| Haatch | 100 | Static HTML (complete) | https://haatch.com/portfolio | Sector + stage (SEIS/EIS) per company. No domains, no HQ. |
| SuperSeed | 34 | Static HTML | https://superseed.com/portfolio | DOM yes, sector description. No HQ, no stage. |
| 7percent Ventures | 60 | Static HTML, paginated (page 1 only captured) | https://7pc.vc/portfolio | Sector tags, fund/angel tag. No domains, no HQ. Pagination present; page URL pattern not identified. |
| LocalGlobe | 26 | Static HTML (homepage highlights) | https://www.phoenixcourt.vc/localglobe (localglobe.vc redirects); full list at /localglobe/companies (not fetched) | Names only from homepage. The companies page should be re-scraped. |
| Notion Capital | 100 | Static HTML | https://www.notioncapital.com/portfolio (notion.vc redirects) | LOC yes (country per company), status Exited/Invested, sector on ~25%. LOC-FILTER yes. No domains. Page claims 126; fetch returned ~100. |
| Octopus Ventures | 16 | Static HTML but only 16 cards served | https://octopusventures.com/portfolio/ | DOM yes, sector, status. No HQ. Sector/status dropdowns; rest of list loads via JS/AJAX (no ?page pagination). Needs headless browser or API discovery. |
| Eight Roads | 68 | Static HTML, server-side paginated + team filter | https://eightroads.com/en/companies (page 1 of 5) and ?team=europe-israel (page 1 of 2) | DOM yes, sector, status; HQ country for some. Team filter (China / Europe & Israel / India / Japan) acts as a region filter. Pagination "Prev 1 2 Next". |
| Molten Ventures | 110 | Static HTML (complete) | https://www.moltenventures.com/portfolio/all (/portfolio is a spotlight view) | DOM yes, sector, investment year. No HQ on cards but a country filter exists (United Kingdom etc.). LOC-FILTER yes. |
| Balderton | 29 | Static HTML, first ~30 only (infinite scroll / JS load) | https://www.balderton.com/companies/ | Excellent per-company data: DOM, HQ city+country, sector, stage+year, status. LOC-FILTER yes (country list incl. UK). Only first page served; ?page=2 and ?location=uk do not change output. Needs headless browser or underlying JSON endpoint. |
| Index Ventures | 327 | Static HTML (names only) | https://www.indexventures.com/companies | Names only on list page; filters by sector, region (Europe etc.) and "Backed at Seed". HQ/domain live on per-company subpages. |
| Atomico | 0 | FAILED | atomico.com/portfolio 429 then 403; /companies 403 | Bot-blocked (Cloudflare). Needs browser session. |
| Dawn Capital | 49 | Static HTML | https://www.dawncapital.com/companies (/portfolio 404) | Name + one-line description + Current/Exited. No domains, HQ or location filter. |
| MMC | 92 | Static HTML | https://mmc.vc/portfolio | Sector + stage + year, Current/Exited. No domains, no HQ. Sector/status filters. |
| Seedcamp | 285 | Static HTML (names in a filterable table) | https://seedcamp.com/our-companies/ (/portfolio and /companies 404) | Names + sector filter + investment year. No HQ, no location filter, no domains on list page. |
| Hoxton Ventures | 94 | Static HTML | https://www.hoxtonventures.com/portfolio | Names + status (Active/Acquired/IPO/Administration etc.). No domains, HQ or sector. |
| Anthemis | 155 | Static HTML (names, some thesis tags) | https://www.anthemis.com/portfolio | Filters: thesis, strategy, stage. No HQ, no location filter, no domains. |
| Amadeus | 45 | Static HTML (homepage list) | https://www.amadeuscapital.com/ (/portfolio 404; nav points to /our-companies/ which was not fetched) | Sector theme (Human/Planet/Intelligence) + description. No HQ or domains. |
| Highland Europe | 18 | Static HTML, first 12 then "Load more" (JS) | https://www.highlandeurope.com/companies/ | Excellent data: DOM, HQ city+country, sector, status. LOC-FILTER yes (UK & Ireland, DACH etc.). Load-more is JS; needs headless or API. |
| Firstminute | 16 | JS-only portfolio page; homepage shows a subset | https://www.firstminute.capital/ (/portfolio serves "No Results Found" without JS) | Sector + region tags on homepage cards. Site claims 170+. Portfolio page has sector/location filters but is JS-rendered. |
| Backed | 92 | Static HTML (complete) | https://backed.vc/portfolio | Region per company (UK/Europe/USA...), sector, status. LOC-FILTER yes (Region incl. UK). No domains. |
| Moonfire | 82 | Static HTML (complete) | https://www.moonfire.com/portfolio | Name + sector description. No HQ, domains, or filters. |
| Playfair | 69 | Static HTML (complete) | https://www.playfair.vc/portfolio.php (/portfolio 404) | Stage per company, sector for some. No HQ, no domains. |
| Crane | 100 | Static HTML (complete) | https://crane.vc/portfolio | Category + stage per company. No HQ, no domains. Category/exited filters. |
| Point Nine | 193 | Static HTML, server-side paginated | https://www.pointnine.com/companies?f34b63bd_page=1..8 | Excellent data: DOM, HQ city+country, sector tags, stage. Filters by stage/sector/country (LOC-FILTER yes). 25 per page, 8 pages. |
| Cherry | 94 | Static HTML (complete) | https://www.cherry.vc/founders (/portfolio 404) | DOM yes, sector, Active/Exit; HQ city for some (mostly Germany). Sector filters, no location filter. |
| Speedinvest | 292 | Static HTML, server-side paginated | https://www.speedinvest.com/portfolio?9ee11496_page=1..6 | Excellent data: DOM, HQ country, sector, status. LOC-FILTER yes (country) plus category/exit filters. ~50 per page, 6 pages, 12 featured companies repeat on every page (dedupe). |
| Creandum | 11 | Homepage only; /portfolio, /companies, /discover all 404 | https://www.creandum.com/ | Only featured names. Company pages live at /discover/<slug> but no index page was found. |
| Partech | 30 | Static HTML, first 30 then "LOAD MORE" (JS) | https://partechpartners.com/companies | Sector + country per company (LOC yes). ?page=2 returns page 1. Needs headless or API. |
| Headline | 52 | Static HTML | https://headline.com/portfolio | HQ city per company (LOC yes), sector, status. Fund/sector/region filters (LOC-FILTER yes). No domains. |
| HV Capital | 0 | FAILED | hv.vc and www.hv.vc: robots.txt fetch blocked (resolves to private IP through proxy) | Retry from a different network or headless browser. |
| Outlier Ventures | 21 | Static HTML, "Load more" (JS) | https://portfolio.outlierventures.io/ (outlierventures.io/portfolio redirects) | Token-project list (crypto), sector tags. No HQ, no domains. Low relevance for UK startup jobs. |
| Techstars London | 2 | JS-only for the filtered list | https://www.techstars.com/accelerators/london ; list link https://www.techstars.com/portfolio?program=Techstars%20London%20Accelerator#search-portfolio | Portfolio search is client-side (program filter in query string but rendered by JS). Needs headless browser; only two alumni names captured from the London page. |

## Summary
- Total rows in funds.csv: 3646
- Funds attempted: 50. Succeeded with at least one row: 45. Failed outright: 5 (20VC, Form Ventures, Atomico, HV Capital, plus Techstars London effectively unusable with 2 rows).
- Best sources for a London/UK filter: Speedinvest (country per company + filter), Point Nine (city + country), Balderton (city + country, JS-loaded), Highland Europe (city + country, JS-loaded), Notion Capital (country), Connect Ventures (country), Backed (region), Headline (city), Molten (country filter), Eight Roads (team filter), Next47 (region).
- Funds where HQ is absent and would need enrichment from domain or Companies House: Episode 1, Passion, Fuel, Kindred, Mosaic, Ascension, Haatch, SuperSeed, 7percent, MMC, Seedcamp, Hoxton, Anthemis, Amadeus, Moonfire, Playfair, Crane, Dawn, Octopus, Index.
