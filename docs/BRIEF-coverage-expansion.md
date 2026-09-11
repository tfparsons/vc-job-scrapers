# Coverage expansion - the two new inputs and how to build them

Date: 11 Sep 2026. Companion to the VC Boards Coverage Audit. Two lists now exist in Airtable; this doc records where they came from, what is loaded, and the technical recipes to grow and consume them. The Claude Code brief is at the end.

## 1. Startup Universe (the company list)

**Where:** base `app4AILlddDnxgRpq` (Employers / Opportunities), table `Startup Universe` (`tbloPq3sVvuKuqjmm`). Deliberately separate from `Employers` (curated, rich) - this one is wide and thin. `Employers row` links the two where they overlap.

**Fields:** Company, Domain (match key), HQ (verbatim), London status (London HQ / London office / UK non-London / Remote-first / Outside UK / Unknown), Stage, Sector, Investors, **Board coverage** (On a scraped board / Investor board scraped, company not listed / Investor has no board / No VC investor known / Unknown), Boards (which scraped boards list it), Careers URL, ATS, ATS slug, Poll (checkbox), Last polled, Last error, Listings pulled (last poll), Source, Last verified, Employers row, Notes.

**What is loaded:** 259 rows - every company with a UK or London HQ in the fund-portfolio scrape. The full scrape is 3,400 unique companies from 45 fund portfolio pages (`docs/data/universe_seed.csv` in the repo, with `funds.csv` and `funds-notes.md` alongside); 2,331 of them have no HQ on the page, 810 are outside the UK. Bulk-loading the rest and enriching HQ is a Claude Code job (below), not an MCP job.

**Board coverage as loaded** is a first pass: "On a scraped board" was set by name-matching against the boards' last-90-day GTM-family listings (500 hits), so it under-counts; "Investor board scraped, company not listed" means at least one investor is one of the 37 scraped funds, but the board may or may not carry the company. The proper computation needs the boards' full company lists - see the `/companies` endpoint below.

### 1a. Sources to make it exhaustive, ranked by coverage per hour

| Source | What you get | Machine-readable | Recipe |
|---|---|---|---|
| Fund portfolio pages (done, 45 funds) | 3,400 companies, domains for ~1,300, HQ for ~1,000 | Mostly static HTML; Balderton, Octopus, Partech, Highland, Firstminute, Visionaries, 7percent, Atomico need a headless browser or their JSON endpoint | `funds-notes.md` has the working URL, pagination and which pages expose HQ or a location filter, per fund. Best-quality pages: Episode 1, Air Street, Speedinvest (6 server-side pages), Point Nine (8 pages), Fuel (4 pages), Molten (`/portfolio/all`, has a UK filter), Connect (country per company). |
| Built In London company directory | 7,386 London companies, 370 pages, names + profile links; website on the profile page | Static HTML, `builtinlondon.uk/companies?country=GBR&page=N`, 20 per page | robots.txt disallows `*?page=` - crawl slowly (one page every few seconds) or skip. Includes corporates (Mastercard, Klaviyo): filter afterwards. No funding-stage filter; has office-type, industry, size, "has open jobs". |
| YC directory | ~100-150 London companies with clean websites | Public Algolia index: app `45BWZJ1SGC`, index `YCCompany_production`, POST `https://45bwzj1sgc-dsn.algolia.net/1/indexes/*/queries` with the public search key from the companies page HTML, `facetFilters=[["regions:London"]]`, `hitsPerPage=1000` (facet name unverified) | Minutes. Fields: name, website, batch, team_size, status. |
| Companies House API (the VC filter) | Not a source of names; the free way to tell startups from agencies and corporates | JSON, free key, 600 req / 5 min | `GET /advanced-search/companies?location=London&sic_codes=62012,62020,63120&incorporated_from=2015-01-01&size=5000`, then per company `/company/{n}/filing-history?category=capital` - SH01 share allotments in the last 4 years = priced rounds. The monthly bulk CSV avoids rate limits. |
| Crunchbase Pro, one month ($99) | London, seed to C, websites, last round date, in one CSV | API + bulk export | The paid shortcut that replaces the two rows above. Free tier is gone. |
| Growth lists (Deloitte Fast 50, FT 1000, TechRound 100, Startups 100) | ~300 names, ~40% London, later-stage skew | Static HTML / PDF | One fetch each. |
| Wellfound `/location/london` | ~1,000 job-led results, company slugs | HTML behind Cloudflare | Headless only; low priority. |
| Dealroom / Beauhurst | The definitive UK sets | Enterprise pricing | Only if a subscription appears. |

### 1b. Board coverage, computed properly

Add `GET /companies?host=<board>` to the Worker: Getro boards serve `https://{host}/companies` as static HTML with "Showing N companies" and one card per company (name, and on most boards a location); Consider boards expose the same search API used for jobs, with a companies query. Store name + domain + location per board; match Startup Universe rows on domain first, normalised name second; write `Boards` and set `Board coverage` = On a scraped board. Rows whose Investors include a scraped fund but which did not match become "Investor board scraped, company not listed" - the opt-in gap the audit found (Causaly, Apron, Birdie, Uncapped, Vitesse, SenseOn, Cortea).

### 1c. ATS detection

Per domain: try `/careers`, `/jobs`, `/join-us`, `/join`, `/work-with-us`, `careers.{domain}`, `jobs.{domain}`; then scan nav links for `career|jobs|join|hiring|open roles`; then regex the page (hrefs, iframe src, script src, redirect Location) for the host signatures. Store ATS + slug + Careers URL.

| ATS | Signature | Public feed (no key) | Has date / location / salary |
|---|---|---|---|
| Ashby | jobs.ashbyhq.com/{slug} | `GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | publishedAt / location + isRemote / compensation |
| Greenhouse | boards.greenhouse.io, job-boards.greenhouse.io, job-boards.eu.greenhouse.io | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` (EU: `boards-api.eu.greenhouse.io`, unverified) | updated_at / location.name / none |
| Lever | jobs.lever.co/{site}, jobs.eu.lever.co | `GET https://api.lever.co/v0/postings/{site}?mode=json&limit=100` (EU: `api.eu.lever.co`) | createdAt / categories.location / salaryRange optional |
| Workable | apply.workable.com/{sub} | `GET https://apply.workable.com/api/v1/widget/accounts/{sub}` | published_on / city, country / none |
| Teamtailor | {sub}.teamtailor.com or custom careers host | `GET https://{careers-host}/jobs.rss?per_page=200` | pubDate / location, remote / none |
| Recruitee | {sub}.recruitee.com | `GET https://{sub}.recruitee.com/api/offers/` | published_at / city, country / salary if set |
| SmartRecruiters | jobs.smartrecruiters.com/{Company} | `GET https://api.smartrecruiters.com/v1/companies/{id}/postings?limit=100` | releasedDate / city, country / none |
| Personio | {sub}.jobs.personio.de or .com | `GET https://{sub}.jobs.personio.de/xml?language=en` | createdAt / office / none |
| Pinpoint | {sub}.pinpointhq.com | `GET https://{sub}.pinpointhq.com/postings.json` | no posted date / location / compensation when visible |
| BambooHR | {sub}.bamboohr.com/careers | `GET https://{sub}.bamboohr.com/careers/list` | publishedAt (unverified) / location / none |
| Workday, Jobvite, HiBob, Homerun, Polymer, Wellfound-as-ATS | see signatures | HTML only or undocumented | fall back to HTML diffing |

Expect 60-70% of seed-to-C London companies on the first five.

### 1d. The poller

Same Worker, new endpoints `/ashby?slug=`, `/greenhouse?slug=`, `/lever?slug=`, `/workable?slug=`, `/teamtailor?host=`, `/recruitee?slug=`, each returning the standard contract (`platform` = the ATS, `source` = the company name, `link` = the ATS job URL, which is canonical). The n8n workflow reads Startup Universe where `Poll = true` and `ATS slug` is set, calls the matching endpoint, applies the same term + location + recency filters, upserts Raw Listings on Link, writes `Last polled` / `Last error` / `Listings pulled (last poll)` back to the row, and the listings ride in the same daily email. job-sweep needs nothing new: `source_label` becomes `VC Boards (<company>)` via the existing `vcboards` extractor, or a second label if we want the poller distinguishable (one-line change in the compose step and the extractor).

Order of enabling: (1) the ~150 rows tagged London HQ / UK once ATS is resolved, (2) the 11 known "investor board scraped, not listed" companies, (3) the growth/PE-backed and vendor-services names from the audit (Nscale, ClearScore, Attest, CUBE, Unity, Hostaway, Prevalent, Trackunit; Clay, Apollo, HubSpot, Cognism, n8n), (4) everything else as HQ enrichment lands.

## 2. Keyword Sources (the alert services)

**Where:** base `appv8Lxbh4kp6DoBv` (VC Job Sweeper), table `Keyword Sources` (`tblInj71uzN2NGOXx`). 22 rows: name, type (email alert / API / RSS / scrape), what it indexes, keywords, location filter, cadence, cost, exact mechanism, setup steps, status, priority, and the run-log fields (Active, Worker endpoint or Sender address, Last run, Last error, Listings pulled) so n8n can log against them exactly as it does for Sources.

**Live today:** LinkedIn saved-search alerts, Welcome to the Jungle, Built In, GTMfund (as a board).

**Priority 1, needs a build:** Adzuna API (`/adzuna?what=` in the Worker, free tier covers 8 titles x 2 locations daily) and Jobs by Workable's undocumented cross-company JSON (`jobs.workable.com/api/v1/jobs?query=&location=London`, the only cross-company window into Workable-hosted startups). Both return created dates and stable links.

**Priority 2:** SerpApi Google Jobs (free 250/month covers 4 titles daily; dedupe on title + company since apply links drift), Glassdoor daily email (needs a senders.csv row + extractor after the first email), RevOps Careers RSS and the Clay community share-jobs RSS (one n8n RSS node each, keyword-filter titles, regex UK/London/remote).

**Priority 3:** Reed API, Indeed email, Cargo scrape (weekly), gtme.jobs weekly digest, Wellfound alerts, RevOps Roles alerts, Google Alerts.

**Rejected, with reasons in the row:** Jooble (500 lifetime calls), Clay's own job board (empty, Typeform-fed), gtmjobs.xyz (0 UK), HubSpot community, Pavilion / RevGenius / RevOps Co-op (members-only, US remote - proactive territory).

**Manual steps only Tim can do (accounts):** add the missing LinkedIn saved searches (GTM Systems, Go-to-Market Engineer, Revenue Systems); create the Glassdoor and Indeed daily alerts for "GTM Engineer" London; subscribe to gtme.jobs and RevOps Roles; register for Adzuna (app_id + app_key), Reed (key) and SerpApi (key) and drop the keys into the Worker as secrets. Forward the first email from each new sender so the extractor can be written against it.

## 3. Claude Code brief

Three sessions, in order. All feed the existing email contract; job-sweep is untouched except for optional labels.

**Session C - Startup Universe.** (1) Bulk-load `docs/data/universe_seed.csv` into `tbloPq3sVvuKuqjmm` via the Airtable REST API (10 records per request, dedupe on Domain then normalised Company against the 259 already loaded). (2) `/companies?host=` on the Worker for Getro and Consider boards; run it over the 37 boards, write `Boards` and `Board coverage` on every row. (3) HQ enrichment for rows with blank HQ: careers-page location text, then the company's own /about, then a Companies House registered-office lookup by name; set `London status`. (4) ATS detection per 1c for rows tagged London or UK; write ATS, ATS slug, Careers URL. Done when London-tagged rows have ATS resolved for at least 60% and every row has a Board coverage value.

**Session D - the poller.** Endpoints per 1d, fixture-tested per ATS; n8n reads `Poll = true` rows and logs back; Poll ticked on the first ~150 London rows plus the named growth/PE and vendor companies. Done when a polled company's new role appears in the next morning's email with a canonical ATS link.

**Session E - keyword sources.** `/adzuna`, `/workable-search`, `/gjobs` (SerpApi), and an `/rss?url=` endpoint for RevOps Careers and Clay community; n8n reads `Keyword Sources` where `Active = true` and `Type != Email alert`, calls the Worker endpoint, logs `Last run` / `Last error` / `Listings pulled`. Guard: keyword sources produce agency and corporate noise by design; they go through the same hard-cut and adjacency gates in job-sweep, so no filtering in the Worker beyond location and recency.

Constraints unchanged: polite fetching, no secrets in the repo (Worker secrets via wrangler), plain hyphens, scraper files under 200 lines, failures in `error` never thrown.
