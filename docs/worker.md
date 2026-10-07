# The Worker: reference

Endpoints, the output contract, the shared filters, the feeds and what their errors mean.
Read this before changing anything in `src/`.
How the Worker fits the nightly run, and the contracts shared with n8n and `job-sweep`, are in `docs/system.md`.

Last reconciled against live: 7 October 2026.
The code wins: `src/config.js` holds the terms, location rules and limits, `src/allowlist.js` holds every host, and `src/lib/filter.js` holds the filter semantics.
This doc describes the contracts and the reasoning; it does not copy the values.

## Endpoints

| Endpoint | What it does |
|---|---|
| `GET /healthz` | `ok`, `version`, `deploy_id` (changes on every deploy) and `secrets` (which API keys are set, as booleans, never values). |
| `GET /consider?host=<board host>` | Consider.com boards. Two requests per board: the board page for cookies and a CSRF token, then one search per term. |
| `GET /consider?host=consider.com&board=<id>` | Boards hosted on consider.com itself, with no vanity domain. The id is the last path segment of `consider.com/boards/vc/<id>/jobs` and is kept in the Sources row's Board ID column. |
| `GET /getro?host=<board host>` | Getro boards. One HTML search per term, parsed for JobPosting cards. |
| `GET /yc` | Y Combinator's Work at a Startup. One JSON search per term plus "london" and "united kingdom". No posted dates. |
| `GET /a16z` | a16z portfolio jobs. One HTML search per term with the board's own `posted=<days>` filter, ATS links. |
| `GET /companies?host=<board host>` | The board's full company list (Consider and Getro; `&board=<id>` for hosted Consider boards). Not a job scraper: it feeds the coverage pass. |
| `GET /ashby?slug=`, `/greenhouse?slug=`, `/lever?slug=`, `/workable?slug=`, `/recruitee?slug=`, `/teamtailor?host=` | One company's open roles from its ATS's public feed, filtered like a board. Optional `&source=<company name>`. |
| `GET /workable-search?q=`, `/rss?feed=revopscareers`, `/rss?feed=clay`, `/adzuna?q=`, `/reed?q=` | Whole-market keyword sources. `q` is a job-title phrase; n8n sends one call per Keywords line. |

`host` must be in `HOSTS` in `src/allowlist.js`; anything else returns the normal envelope with `error: "host not allowed: ..."`.
`/yc` and `/a16z` are single-host platforms and take no `host`.

Debug overrides, accepted by every scraper endpoint (n8n calls with defaults): `?terms=gtm,growth` replaces the search terms for the call, `?loc=all` disables the location filter, `?days=30` widens the recency window.
The `config` block in the response echoes the values actually used.

## Output contract

Every scraper endpoint returns HTTP 200 with this shape.
It never throws; failures go in `error`.

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

Field rules, each with the reason it is a rule:

- Fields are verbatim from the board.
  `location` is never reformatted; several locations are joined with `; `.
  Downstream filters are tuned to what boards actually print.
- `salary_raw` is set only when the board shows a whole-line compensation string: Getro's "Compensation:" line, Ashby's compensation summary, Lever's salary range.
  Consider exposes a structured salary that is often an estimate, so it is always null there.
  The downstream sweep hard-excludes on salary, so empty is safe and wrong drops a good role.
- `posted_date` is `YYYY-MM-DD` or null.
  Getro gives a date in the microdata and a relative age in the text; the relative text is kept in `posted_relative` and used as a fallback when the date is missing.
  "N months" and older stay null and are dropped by the recency filter.
  YC exposes no date at all, so its listings always pass recency; dedupe on link keeps the email to new ones.
- `remote` is the platform's boolean flag where one exists (Consider, Ashby, Workable, Recruitee, Lever, Teamtailor) and null elsewhere; the other platforms put "Remote" in the location string.
- `link` is the role's identity downstream and must be stable run to run.
  For Consider it is the canonical ATS URL (`url`, never `applyUrl` with its tracking suffix).
  For Getro it is the board's own listing page with the fragment removed.
  For ATS feeds it is the ATS's own job URL.
  For a16z and Adzuna the tracking query is stripped.
- `matched_terms` records which search terms returned the listing, in config order.
  It is search provenance, not a title check: Getro's search is fuzzy, Consider's is a word-prefix match on the title, and the feeds are matched here on whole words.
- `counts` is for debugging the filters: `fetched` is raw hits across all term searches, `unique` after dedupe on `link`, then `after_location`, then `after_recency`, which equals `listings.length`.
  On a feed, `fetched` is the number of open roles, not term hits.
  On a big Getro or a16z board, `fetched` sits at the per-search cap times the number of terms; it is not the board's total.
- `error` is null, a short string, or a `partial:` string when some term searches failed and others returned listings.
  Treat `partial:` as a warning, not a failed board.

## Filters

Filter semantics live once in `src/lib/filter.js` and run at the end of every scraper, in this order.

- Terms: search each term, union the results, dedupe on `link`.
  For feeds and keyword sources, which have no search, a listing is kept when a term appears in its title as a whole word.
- Location: keep if `location` is empty; or if it names London, the UK, EMEA or Europe as a whole word (so "UK" does not match "Ukraine"); or if it is remote and does not name a region on the remote exclude list, which covers the US, Canada, the Americas, APAC and the main US hub cities.
  So "Remote - EMEA" stays, "Remote - United States" goes, and on-site roles in other EU cities go.
  *Why remote is conditional:* "any Remote" let US-remote roles dominate one board's results.
- Recency: keep if `posted_date` is empty, or within the window of `scraped_at` counted in calendar days.
  An empty date with a relative age of months or years is dropped.

Changing a term, a location rule or the window is a config change and a push.

## Consider and Getro

Consider boards are client-rendered: the HTML has no listings, and the search API wants the page's cookies and CSRF token.
The search key is `titlePrefix`; the API silently ignores `query` and returns the same newest jobs for any term.
Consider searches run a few at a time.

Getro boards are server-rendered with schema.org JobPosting cards, a fixed number per search.
Getro searches run one at a time per board with a longer timeout and one retry on a timeout, because Getro degrades and times out under parallel requests.
That makes a Getro board the slowest thing in the run, which is why the caller's timeout is long.

To tell the platforms apart: a Consider page source contains `"csrfToken"`; a Getro page contains `data-testid="job-list-item"` and "Powered by Getro".
Boards do move between platforms; a board that suddenly returns zero cards on every term is the usual sign.

## ATS feeds

Six endpoints, one per ATS with a public feed, each taking the slug stored in Startup Universe's ATS slug column.

| Endpoint | Feed |
|---|---|
| `/ashby?slug=` | Ashby posting API, with compensation |
| `/greenhouse?slug=` | Greenhouse boards API, then the EU API on 404 |
| `/lever?slug=` | Lever postings API, then the EU API on 404 |
| `/workable?slug=` | Workable widget API |
| `/recruitee?slug=` | Recruitee offers API |
| `/teamtailor?host=` | The company's own host, `/jobs.rss` |

One GET per call, then the title match and the shared filters.
`platform` is the ATS, `source` is the `&source=` the caller passes (n8n sends the company name) or the slug.
Greenhouse and Workable name the company in the feed; the others take it from `source`.
Workable answers 429 to a burst, so a 429 gets two slow retries; waiting costs the Worker no CPU.

Guards: a slug must match `[a-z0-9][a-z0-9._-]*` and is only ever inserted into that ATS's own API URL.
A Teamtailor host must be `*.teamtailor.com` or listed in `TEAMTAILOR_HOSTS`, because that endpoint fetches the host directly.

## Keyword sources

| Endpoint | Source | Key |
|---|---|---|
| `/workable-search?q=` | Jobs by Workable cross-company search, London, quoted phrase, a few pages | none |
| `/rss?feed=revopscareers` | RevOps Careers job feed, United Kingdom, latest roles | none |
| `/rss?feed=clay` | Clay community share-jobs RSS, free text | none |
| `/adzuna?q=` | Adzuna UK search, London, the recency window as max age | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` |
| `/reed?q=` | Reed search, London, direct employers only | `REED_API_KEY` |

A listing is kept when its title contains `q` or any config term as a whole word, then the shared filters.
Adzuna salaries are kept only when Adzuna did not predict them.
Clay posts are free text, so `company` and a location hint are parsed from the title.
RevOps Careers is slow to answer, so it is one location-only call with its own long timeout.
`/rss` takes an allowlisted feed name, never a URL: the allowlist is the abuse guard.

Keys are Worker secrets, set with `npx wrangler secret put <NAME>`.
A missing key gives `<source>: secret not set: ...` in `error` and fetches nothing; a rejected key gives `HTTP 401 (check the API key secret)`.

## Company lists

`/companies` returns every company a Consider or Getro board lists, from the platforms' own JSON: Getro's collections search (the network id comes from the companies page), Consider's `search-companies` on the jobs session.
Its response is its own contract, not the listings envelope: `companies`, each with `name`, `domain`, `location`, `stage` (the platform's own token), `jobs_count`, `ats` (Consider's job-source ids, empty on Getro) and `link`, plus `counts.total` and `counts.fetched`.
`scripts/coverage.mjs` is its only consumer (`docs/scripts.md`).

## Error strings

| `error` | Usually means |
|---|---|
| `host not allowed: x` | `host` is missing or not in the allowlist. |
| `consider: 412 INVALID_CSRF` | The token or cookies were not carried. Every Consider board at once means Consider changed something. |
| `consider: non-JSON response (HTTP 404)` | The host is not a Consider board any more, or the API path moved. |
| `consider: csrf token or board id not found in page` | The board page markup changed. |
| `getro: 0 cards on all terms (DOM change?)` | The page still says "Powered by Getro" but no cards parsed. Every Getro board at once means Getro changed its markup. |
| `getro: HTTP 503 for gtm` | Every term search failed; the first failure is shown. Same shape for `yc:` and `a16z:`. |
| `board required for consider.com: ?board=<id>` | A hosted Consider board was called without its board id. |
| `partial: 2/10 term fetches failed: ...` | Some searches timed out or errored; the listings from the rest are still returned. |
| `<source>: secret not set: ...` | A keyword source's Worker secret is missing. |
| `unhandled: ...` | A bug. The stack is in `npm run tail`. |

## How to add a board

- Consider or Getro: add one line to `HOSTS` in `src/allowlist.js` with the platform and a short `source` slug, deploy, then add a Sources row whose Worker endpoint is `/<platform>?host=<host>` on the Worker's URL.
  Leave Active unticked until the deploy is live: an unknown host returns `host not allowed`, and enough of those turn the night DEGRADED.
- A Consider board with no vanity domain: no allowlist change.
  The Sources row's endpoint is `/consider?host=consider.com&board=<id>` and its Board ID column holds `<id>`.
- Anything else: a new module in `src/scrapers/`, a route in `src/index.js`, a fixture and a test.
  Keep parsing functions pure (HTML or JSON in, listings out) so they test without the network, and run the shared filter at the end.

Not covered: 83North's page is one paragraph naming two titles with no links, companies or dates, so there is nothing to scrape.
Molten Ventures and Eight Roads are open questions in `docs/system.md`.

## Limits and politeness

- Free tier: 10 ms CPU per request and 50 subrequests.
  A board uses 10 to 13 requests and a few milliseconds of CPU; the rest is waiting on the network, which does not count.
  Do not upgrade pre-emptively; the signal is "Script exceeded time limit" in the Cloudflare logs.
- One pass per board per day, a descriptive User-Agent naming this repo, and no retry except the single second attempt on a Getro timeout and the slow retries on a Workable 429.
  A board that rate-limits or blocks the User-Agent is lost to the nightly run.
- No state, no caching, no auth.
  The host allowlist is the abuse guard.

## Tests and layout

`npm test` runs the parsers against saved fixtures in `test/fixtures/` (one per platform, feed and keyword source) and compares with `test/snapshots/`, and unit-tests the filter, relative-date, cookie and HTML helpers, which is where silent drops would come from.
After an intended parser change, `npm run test:update` rewrites the snapshots; read that diff before committing it, because it is the behaviour change.
A fixture is refreshed by saving the live response the scraper fetches; the Consider fixtures need the page's cookies and CSRF token sent back on the search.

```
src/
  index.js              router, query overrides, envelope
  config.js             terms, location rules, recency window, User-Agent, concurrency and timeouts
  allowlist.js          every host and its platform and source slug; Teamtailor custom hosts
  scrapers/             one module per platform, feed family and keyword family
  lib/filter.js         dedupe on link, location, recency, counts
  lib/relative-date.js  relative ages to dates
  lib/cookies.js        Set-Cookie headers to a Cookie header
  lib/html.js           entity decoding, tag stripping
  lib/http.js           fetch with User-Agent and timeout; small worker pool
  lib/respond.js        the contract envelope; never-throw wrapper
test/
  fixtures/             saved responses
  snapshots/            expected parser output
  *.test.js             node:test suites
```

Plain JavaScript ES modules, zero runtime dependencies, scraper files under 200 lines, plain hyphens everywhere.
