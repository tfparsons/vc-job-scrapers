# VC Job Scrapers

Cloudflare Worker that fetches VC portfolio job boards, applies a small provider
config (search terms, location keep-list, recency) and returns clean JSON. An
external n8n workflow calls each endpoint once a day, keeps state in Airtable and
emails a digest. This repo's job ends at "return good JSON from a URL".

Out of scope here: state, dedupe, email, scoring, anything with an LLM. There
are no secrets and nothing to store.

Design of record: [BRIEF.md](BRIEF.md) (this Worker) and [docs/PLAN.md](docs/PLAN.md)
(the wider pipeline).

Live at `https://vc-job-scrapers.tfparsons87.workers.dev`.

The caller is the n8n workflow "VC Boards Sweep" (id `AQzbFqr1Pi0uyWMd`, folder
VC Job Boards) which runs daily at 06:30 London, reads the Sources table in the
VC Job Sweeper Airtable base (`appv8Lxbh4kp6DoBv`), upserts Raw Listings on
Link, and emails tfparsons87@gmail.com. To pause a board, untick Active on its
Sources row. To pause everything, deactivate the workflow.

## Endpoints

| Endpoint | What it does |
|---|---|
| `GET /healthz` | `{"ok": true, "version": "2.3.0", "deploy_id": "...", "secrets": {"adzuna": true, "reed": false}}`. `secrets` says which API keys are set, never their values. `deploy_id` changes on every deploy. |
| `GET /consider?host=<board host>` | Consider.com boards. Two requests per board: the board page for cookies and a CSRF token, then one search per term. |
| `GET /consider?host=consider.com&board=<id>` | Boards hosted on consider.com itself (no vanity domain), e.g. `board=point72-ventures`. The board id is the last path segment of `https://consider.com/boards/vc/<id>/jobs` and is also kept in the Sources row's Board ID column. |
| `GET /getro?host=<board host>` | Getro boards. One HTML search per term, parsed for JobPosting cards. |
| `GET /yc` | Y Combinator's Work at a Startup. One JSON search per term plus "london" and "united kingdom". 30 results per query, no posted dates. |
| `GET /a16z` | a16z portfolio jobs. One HTML search per term with `posted=<max_age_days>`, 25 cards per query, ATS links. |
| `GET /companies?host=<board host>` | The board's full company list (Consider and Getro boards, `&board=<id>` for hosted Consider boards). Not a job scraper: it feeds the Startup Universe coverage check, see below. |
| `GET /adzuna?q=`, `/reed?q=`, `/workable-search?q=`, `/rss?feed=revopscareers`, `/rss?feed=clay` | Whole-market keyword sources. `q` is a job-title phrase; n8n sends one call per Keywords line of the Keyword Sources row. See "Keyword sources" below. |
| `GET /ashby?slug=`, `/greenhouse?slug=`, `/lever?slug=`, `/workable?slug=`, `/recruitee?slug=`, `/teamtailor?host=` | One company's open roles from its ATS's public feed, filtered like a board. Optional `&source=<company name>`. See "ATS feeds" below. |

`host` must be on the allowlist in [src/allowlist.js](src/allowlist.js). Anything
else returns the normal envelope with `error: "host not allowed: ..."`.

### Consider boards (12)

`jobs.notion.vc`, `careers.balderton.com`, `jobs.phoenixcourt.vc`,
`jobs.hoxtonventures.com`, `jobs.anthemis.com`, `jobs.amadeuscapital.com`,
`careers.highlandeurope.com`, `jobs.sequoiacap.com`, `jobs.lsvp.com`,
`careers.playfair.vc`, `jobs.gtmfund.com`, and `consider.com` with
`board=point72-ventures`.

### Getro boards (23)

`jobs.dawncapital.com`, `indexventures.getro.com`, `talent.seedcamp.com`,
`jobs.mmc.vc`, `talent.octopusventures.com`, `opportunities.northzone.com`,
`jobs.accel.com`, `careers.atomico.com`, `portfolio.joinef.com`,
`jobs.generalcatalyst.com`, `portfoliojobs.partechpartners.com`,
`talent.cherry.vc`, `positions.moonfire.com`, `jobs.hvcapital.com`,
`jobs.headline.com`, `careers.crane.vc`, `jobs.pointnine.com`,
`jobs.firstminute.capital`, `talent.backed.vc`, `jobs.outlierventures.io`,
`careers.speedinvest.com`, `jobs.techstars.com`, `careers.creandum.com` (moved
from Consider to Getro, September 2026)

### Single-host platforms (2)

`www.workatastartup.com` (`/yc`) and `jobs.a16z.com` (`/a16z`). `host` can be
omitted for these.

A note on `counts.fetched`: Getro returns 20 cards per search and a16z 25,
newest or most relevant first, so on a big board `fetched` sits at that cap
times the number of terms. It is not the board's total. At daily cadence with a
7 day window that is fine; older matches are simply not visible.

### Debug overrides

Every scraper endpoint accepts these. n8n calls with defaults.

| Param | Effect |
|---|---|
| `?terms=gtm,growth` | Replace the search terms for this call. |
| `?loc=all` | Disable the location filter (both the keep-list and the remote exclude list). |
| `?days=30` | Widen the recency window. |

The `config` block in the response echoes the values actually used, so
`?loc=all` shows `"location_keep": null`.

## Output contract

Every scraper endpoint returns HTTP 200 with this shape. It never throws;
failures go in `error`.

```json
{
  "source": "seedcamp",
  "platform": "getro",
  "scraped_at": "2026-09-03T06:30:00.000Z",
  "config": {"terms": ["gtm", "growth"], "location_keep": ["london", "uk"], "remote_exclude": ["united states", "usa"], "max_age_days": 7},
  "listings": [
    {
      "company": "Zinc",
      "title": "GTM Operations Lead",
      "location": "London, UK",
      "posted_date": "2026-08-29",
      "posted_relative": "4 days",
      "seniority": "Mid-Senior Level",
      "salary_raw": null,
      "remote": null,
      "link": "https://talent.seedcamp.com/companies/zinc-3/jobs/91587943-gtm-operations-lead",
      "matched_terms": ["gtm", "revops"]
    }
  ],
  "counts": {"fetched": 243, "unique": 152, "after_location": 61, "after_recency": 18},
  "error": null
}
```

Field rules:

- Fields are verbatim from the board. `location` is never reformatted. Where a
  board shows several locations they are joined with `; `.
- `salary_raw` is only set when the board shows a whole-line compensation string
  (Getro's "Compensation:" line). Consider exposes a structured salary object
  that is often an estimate, so it is always null there. Empty is safe, wrong is
  dangerous: the downstream sweep hard-excludes on bad salaries.
- `posted_date` is `YYYY-MM-DD` or null. Getro gives a date in the microdata and
  a relative age ("4 days") in the text; the relative text is kept in
  `posted_relative` and used as a fallback when the date is missing. "N months"
  and older stay null. Consider gives an ISO timestamp; `posted_relative` is
  null there.
- `remote` is Consider's boolean flag. The other platforms have no flag, so it
  is null; they put "Remote" in the location string instead.
- YC exposes no posted date at all, so its listings always have `posted_date`
  null and pass the recency filter. Dedupe on link keeps the daily email to
  genuinely new ones.
- `link` is the role's identity downstream, so it must be stable run to run. For
  Consider it is the canonical ATS URL (`url`, never `applyUrl` with its utm
  suffix). For Getro it is the board's own listing page with `#content` removed.
- `matched_terms` records which search terms returned the listing, in config
  order. It is search provenance, not a title check: Getro's search is fuzzy,
  so "growth" can return a Marketing Manager. Consider's search is a word-prefix
  match on the title.
- `counts` is for debugging the filters: `fetched` is raw hits across all term
  searches, `unique` after dedupe on `link`, then `after_location`, then
  `after_recency` (which equals `listings.length`).
- `error` is null, a short string, or a `partial:` string when some term
  searches failed but others returned listings. Treat `partial:` as a warning,
  not a failed board.

## ATS feeds (the per-company poller)

Six endpoints, one per ATS with a public feed, each taking the board id
Session C stored in Startup Universe's `ATS slug` column:

| Endpoint | Feed |
|---|---|
| `/ashby?slug=` | `api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` |
| `/greenhouse?slug=` | `boards-api.greenhouse.io/v1/boards/{slug}/jobs`, then the `.eu` API on 404 |
| `/lever?slug=` | `api.lever.co/v0/postings/{slug}?mode=json`, then `api.eu.lever.co` on 404 |
| `/workable?slug=` | `apply.workable.com/api/v1/widget/accounts/{slug}` |
| `/recruitee?slug=` | `{slug}.recruitee.com/api/offers/` |
| `/teamtailor?host=` | `https://{host}/jobs.rss?per_page=200` |

One GET per call. The feeds have no search, so the term match happens here:
a role is kept when a configured term appears in its title as a whole word,
and `matched_terms` lists which. Then the shared location and recency
filters. Same envelope as the boards, with `platform` = the ATS, `source` =
the `&source=` the caller passes (n8n sends the company name) or the slug,
and `link` = the ATS's own job URL, which is canonical. `counts.fetched` is
the number of open roles on the feed, not term hits.

Field notes: `salary_raw` is Ashby's `compensationTierSummary` (the line the
board shows) or Lever's `salaryRange` formatted as `GBP 60,000-80,000 /
year`; the other feeds have no salary. `remote` is Ashby `isRemote`,
Workable `telecommuting`, Recruitee `remote`, Lever `workplaceType` =
remote, Teamtailor `remoteStatus` fully remote (hybrid is false). Greenhouse
and Workable name the company in the feed; the others take it from `source`.

Guards: a slug must match `[a-z0-9][a-z0-9._-]*` and is only ever inserted
into that ATS's own API URL. A Teamtailor host must be `*.teamtailor.com`
or listed in `TEAMTAILOR_HOSTS` in [src/allowlist.js](src/allowlist.js),
since that endpoint fetches the host directly.

## Keyword sources

| Endpoint | Source | Key |
|---|---|---|
| `/adzuna?q=` | Adzuna UK search: `what_phrase=q`, `where=London`, `max_days_old` = the recency window | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` |
| `/reed?q=` | Reed search: London within 15 miles, direct employers only | `REED_API_KEY` (basic-auth username) |
| `/workable-search?q=` | Jobs by Workable cross-company JSON: quoted phrase, London, up to 3 pages | none |
| `/rss?feed=revopscareers` | RevOps Careers job feed (`?feed=job_feed&search_location=United Kingdom`), latest 10 UK roles | none |
| `/rss?feed=clay` | Clay community share-jobs RSS | none |

A listing is kept when its title contains `q` or any config term as a whole
word, then the shared location and recency filters run; `matched_terms`
lists what matched. Adzuna salaries are kept only when Adzuna did not
predict them, and the tracking query is stripped from `redirect_url`. Clay
posts are free text, so `company` and a location hint are taken from the
title ("... at Sprinto (Remote, India-based)"). RevOps Careers answers in
11 to 22 seconds, so it is one location-only call with a 40 s timeout.

Keys are Worker secrets, set with `npx wrangler secret put ADZUNA_APP_ID`
(the command asks for the value). A missing key gives
`adzuna: secret not set: ...` in `error` and nothing is fetched; a rejected
key gives `HTTP 401 (check the API key secret)`.

## Company lists (`/companies`)

Every Consider and Getro board publishes the companies it lists, and both
platforms expose that list as JSON without auth:

- **Getro**: `GET https://{host}/companies` is a Next.js page whose
  `__NEXT_DATA__` carries the network id; then
  `POST https://api.getro.com/api/v2/collections/{id}/search/companies` with
  `{"hits_per_page": 1000, "page": 0}`. A short page is the last page.
- **Consider**: the same session as the jobs search (page cookies plus CSRF
  token), then `POST /api-boards/search-companies`, paged with
  `meta.sequence` exactly like `search-jobs`.

The response is its own contract, not the listings envelope:

```json
{
  "source": "dawn", "platform": "getro", "scraped_at": "2026-09-16T10:00:00.000Z",
  "companies": [
    {"name": "Ably", "domain": "ably.com", "location": "London, UK; Boston, MA, USA",
     "stage": "series_b", "jobs_count": 7, "ats": [], "link": "https://jobs.dawncapital.com/companies/ably-2"}
  ],
  "counts": {"total": 42, "fetched": 42},
  "error": null
}
```

`stage` is the platform's own token (Getro `series_b`, Consider `Series B`).
`ats` is Consider's `jobSources` ids (`ashbyhq`, `greenhouse`, `lever`,
`workable`, ...), empty on Getro. `location` joins every office the board
shows with `; `. All 35 boards return in 1 to 4 s each; Techstars is the
largest at about 2,900 companies.

`scripts/coverage.mjs` runs this over every board, matches Startup Universe
rows on domain first and normalised name second, and writes `Boards` and
`Board coverage` on every row, filling `Domain`, `HQ` and `London status`
from the board where the row had none. A name-only match is trusted only
when the row's investors include a board it was found on, or the name is
eight or more characters and unique across boards; short names ("Scale",
"Ramp") exist many times over. It needs `AIRTABLE_TOKEN` in the environment
or a gitignored `.env`; `--dry-run` writes `coverage-updates.json` and
changes nothing. Rerunning is a no-op once the table is up to date.

## Domain resolution (`scripts/resolve-domains.mjs`, `scripts/apply-domains.mjs`)

Rows with a name but no domain cannot be matched to boards or probed for an
ATS. `resolve-domains.mjs` searches Google through SerpApi (`SERPAPI_KEY` in
the environment or `.env`; the free tier is 250 searches a month, so pass
`--limit`) and takes the first result that is not a directory or social
site and whose domain label is the company name; a title-only match is
accepted only when the title does not read like coverage of the company.
Output is `{id, company, domain, confidence, evidence}` per row, the same
shape the web-search batches used, and `apply-domains.mjs` writes it:
Domain for high and medium results after checking the site answers, a
dated Notes line for dead or unresolved rows, nothing for rows that were
never actually searched. Existing domains are never overwritten. Rerun
`coverage.mjs` and `ats-detect.mjs --all` afterwards.

## ATS detection (`scripts/ats-detect.mjs`)

For every Startup Universe row with a domain and no ATS yet (London / UK rows
by default, `--all` for every row), fetch the homepage, follow its careers
link, try `/careers`, `/jobs`, `/join-us` and friends, and look for ATS host
signatures in hrefs, iframes, scripts and redirects: Ashby, Greenhouse,
Lever, Workable, Teamtailor (including custom hosts, spotted by their
`teamtailor-cdn.com` assets), Recruitee (including the `RTWidget` embed),
SmartRecruiters, Personio, Pinpoint, BambooHR, Workday, and a bucket of
others. When a careers page lists roles at its own URLs, the first job page
is read too, because its apply button usually points at the ATS. When a page
names the vendor without a slug (an `ashby_embed` div, an API base URL with
the slug added in JavaScript), the slug is guessed from the domain label and
company name and accepted only if the public feed answers. Every slug with a
public feed is verified by calling it, so `Poll` rows can be trusted.

Writes `ATS`, `ATS slug`, `Careers URL`, `Last verified`, and a dated Notes
line when nothing was found. `None found` means the site was reached and no
signature was seen; the Notes line says whether a careers page existed.
Polite: four domains at a time, 12 s per request, at most six requests per
domain, descriptive User-Agent. About 55% of reachable companies with a
careers page resolve to a verified slug on the first pass; the rest are
mostly in-house careers sites, HR-tech firms running their own ATS, or
companies with nothing open.

## Provider config

[src/config.js](src/config.js) holds the search terms, the location keep-list,
the recency window, the User-Agent and the concurrency limits. Changing it is a
push.

Filter semantics live once in [src/lib/filter.js](src/lib/filter.js) and apply
to every scraper:

- **Terms**: search each term per board, union the results, dedupe on `link`.
- **Location**: keep if `location` is null or empty (deliberate: a no-location
  GTM Engineer at Framer was once dropped downstream); or if it names London,
  the UK, EMEA or Europe (whole-word, case-insensitive, so "UK" does not match
  "Ukraine"); or if it is remote (the word "Remote" or the platform's `remote`
  flag) and does not name a region on the remote exclude list, which covers
  the US, Canada, the Americas, APAC and the main US hub cities. So
  "Remote - EMEA" stays, "Remote - United States" and "US-Remote" go, and
  on-site roles in other EU cities go.
- **Recency**: keep if `posted_date` is null, or within `max_age_days` of
  `scraped_at` counted in calendar days. A null date with a `posted_relative`
  of "N months" or "N years" is dropped.

## Error strings

| `error` | Usually means |
|---|---|
| `host not allowed: x` | `host` is missing or not in the allowlist. |
| `consider: 412 INVALID_CSRF` | The token or cookies were not carried. If every Consider board says this at once, Consider changed something. |
| `consider: non-JSON response (HTTP 404)` | The host is not a Consider board any more, or the API path moved. |
| `consider: csrf token or board id not found in page` | The board page markup changed. |
| `getro: 0 cards on all terms (DOM change?)` | The page still says "Powered by Getro" but no cards parsed. If every Getro board says this at once, Getro changed its markup. |
| `getro: HTTP 503 for gtm` | Every term search failed; the first failure is shown. Same shape for `yc:` and `a16z:`. |
| `board required for consider.com: ?board=<id>` | A hosted Consider board was called without its board id. |
| `partial: 2/15 term fetches failed: ...` | Some searches timed out or errored; the listings from the rest are still returned. |
| `unhandled: ...` | A bug. The stack is in `wrangler tail`. |

## How to add a board

- **Consider or Getro**: add one line to `HOSTS` in
  [src/allowlist.js](src/allowlist.js) with the platform and a short `source`
  slug, push, and add a Sources row in Airtable whose Worker endpoint is
  `https://vc-job-scrapers.tfparsons87.workers.dev/<platform>?host=<host>`.
  Leave the row's Active box unticked until the deploy is live: a host that
  is not yet allowlisted returns `host not allowed`, and six or more erroring
  boards trip the FAILED guard for the whole run. To tell the platforms
  apart: a Consider board's page source contains `"csrfToken"`, a Getro page
  contains `data-testid="job-list-item"` and "Powered by Getro".
- **A Consider board with no vanity domain** (its URL is
  `consider.com/boards/vc/<id>/jobs`): no allowlist change. The Sources row's
  endpoint is `/consider?host=consider.com&board=<id>` and its Board ID
  column holds `<id>`.
- **Anything else**: a new module in `src/scrapers/`, a route in
  [src/index.js](src/index.js), a fixture in `test/fixtures/` and a test. Keep
  parsing functions pure (HTML or JSON in, listings out) so they can be tested
  without the network, and run the shared filter at the end.

Not covered and why:

- **83North** (`83north.com/open-positions/`): the page is a single paragraph
  listing two role titles with no links, companies or dates, and its ld+json
  has no JobPosting. There is nothing to scrape.
- **Molten**, **Eight Roads**: deferred spikes, see BRIEF.md.

## Local development

```
npm install
npm run dev
```

Then, with no Cloudflare login needed:

```
curl "localhost:8787/healthz"
curl "localhost:8787/consider?host=jobs.notion.vc&terms=gtm"
curl "localhost:8787/getro?host=jobs.dawncapital.com&loc=all&days=30"
```

Smoke-test every board (swap in the deployed URL to check production):

```
for h in jobs.notion.vc careers.balderton.com jobs.phoenixcourt.vc jobs.hoxtonventures.com jobs.anthemis.com jobs.amadeuscapital.com careers.highlandeurope.com jobs.sequoiacap.com; do
  curl -s "localhost:8787/consider?host=$h" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.source,JSON.stringify(j.counts),j.error)})'
done
for h in jobs.dawncapital.com indexventures.getro.com talent.seedcamp.com jobs.mmc.vc talent.octopusventures.com opportunities.northzone.com jobs.accel.com careers.atomico.com portfolio.joinef.com; do
  curl -s "localhost:8787/getro?host=$h" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.source,JSON.stringify(j.counts),j.error)})'
done
```

## Tests

```
npm test
```

`test/fixtures/` holds one saved Getro search page (Dawn, `?q=gtm`) and one
saved Consider board page plus search response (Notion). `test/*.test.js` run
the parsers against them and compare with `test/snapshots/*.json`, and
unit-test the filter, relative-date, cookie and HTML helpers, which is where
silent drops would come from. After an intended parser change run
`npm run test:update` to rewrite the snapshots and review the diff.

Refreshing fixtures:

```
curl -A "VC-Job-Scrapers/2.0" "https://jobs.dawncapital.com/jobs?q=gtm" > test/fixtures/getro-dawn-gtm.html

# Consider: keep the cookies from the page request and send the CSRF token back
curl -s -c jar.txt https://jobs.notion.vc/jobs > test/fixtures/consider-notion-page.html
TOKEN=$(grep -o '"csrfToken":"[^"]*"' test/fixtures/consider-notion-page.html | cut -d'"' -f4)
curl -s -b jar.txt -X POST https://jobs.notion.vc/api-boards/search-jobs \
  -H "Content-Type: application/json" -H "x-csrf-token: $TOKEN" \
  -H "Origin: https://jobs.notion.vc" -H "Referer: https://jobs.notion.vc/jobs" \
  -d '{"meta":{"size":100},"board":{"id":"notion-capital","isParent":true},"query":{"promoteFeatured":true,"titlePrefix":"product manager"}}' \
  > test/fixtures/consider-notion-search.json
```

## Deploying

The Worker lives in the tfparsons87@gmail.com Cloudflare account (subdomain
`tfparsons87.workers.dev`). An older copy from April sits in the
tim@nauticusstudios.com account at `vc-job-scrapers.tfparsons.workers.dev`;
it is stale and can be deleted.

Two ways to deploy:

- `npx wrangler login` once (choose the tfparsons87 account), then
  `npm run deploy`.
- Pushes to `main` through Cloudflare's GitHub integration (Workers Builds):
  dashboard, Workers & Pages, `vc-job-scrapers`, Settings, Builds, connect
  `tfparsons/vc-job-scrapers` on branch `main`, no build command, deploy
  command `npx wrangler deploy`.

To confirm a deploy landed, compare `deploy_id` from `/healthz` before and
after, or look for the Cloudflare check on the commit in GitHub.

## Limits and politeness

- Free tier: 10 ms CPU per request and 50 subrequests. A board uses 15 to 18
  requests and a few milliseconds of CPU; the rest is waiting on the network,
  which does not count. Do not upgrade pre-emptively; the signal is "Script
  exceeded time limit" in the Cloudflare logs.
- Consider searches run 4 at a time and a board takes 2 to 3 s. Getro
  searches run one at a time because Getro slows sharply and times out when
  hit in parallel; from Cloudflare's edge each search takes about 3 s, so a
  Getro board takes 20 to 60 s end to end. Consider requests have a 15 s
  timeout, Getro requests 25 s. Set the caller's HTTP timeout to 120 s.
- One pass per board per day, descriptive User-Agent. The only retry is a
  single second attempt when a Getro search times out.
- No state, no caching, no auth. The host allowlist is the abuse guard.

## Layout

```
src/
  index.js              router: /healthz, /consider, /getro, /yc, /a16z, /companies; query overrides; envelope
  config.js             TERMS, LOCATION_KEEP, LOCATION_REMOTE_EXCLUDE, MAX_AGE_DAYS, USER_AGENT
  allowlist.js          the 37 hosts and their platform / source slug
  scrapers/consider.js  session (cookies + CSRF), search per term, field mapping
  scrapers/getro.js     split-on-card parser, search per term
  scrapers/yc.js        Work at a Startup search JSON per term
  scrapers/a16z.js      a16z cards per term with posted=<days>
  scrapers/companies.js board company lists (Getro collections API, Consider search-companies)
  scrapers/ats.js       per-company ATS poller: one feed GET, title term match, shared filters
  scrapers/ats-feeds.js the six feed mappers (Ashby, Greenhouse, Lever, Workable, Teamtailor, Recruitee)
  scrapers/keyword.js   keyword source endpoints: request building, secrets, title filter
  scrapers/keyword-feeds.js mappers for Adzuna, Reed, Jobs by Workable, RevOps Careers, Clay
  lib/filter.js         dedupe on link, location keep-list, recency, counts
  lib/relative-date.js  "4 days" -> "2026-08-29"
  lib/cookies.js        Set-Cookie headers -> Cookie header
  lib/html.js           entity decoding, tag stripping
  lib/http.js           fetch with User-Agent and timeout; small worker pool
  lib/respond.js        the contract envelope; never-throw wrapper
scripts/
  coverage.mjs          Startup Universe board coverage pass (local, needs AIRTABLE_TOKEN)
  ats-detect.mjs        ATS + slug detection per domain, feed-verified (local)
  lib/airtable.mjs      REST helper and Startup Universe field ids for the scripts
test/
  fixtures/             saved board responses
  snapshots/            expected parser output
  *.test.js             node:test suites
```

Plain JavaScript ES modules, zero runtime dependencies, scraper files under
200 lines, plain hyphens everywhere.
