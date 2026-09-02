# VC Job Scrapers

Cloudflare Worker that fetches VC portfolio job boards, applies a small provider
config (search terms, location keep-list, recency) and returns clean JSON. An
external n8n workflow calls each endpoint once a day, keeps state in Airtable and
emails a digest. This repo's job ends at "return good JSON from a URL".

Out of scope here: state, dedupe, email, scoring, anything with an LLM. There
are no secrets and nothing to store.

Design of record: [BRIEF.md](BRIEF.md) (this Worker) and [docs/PLAN.md](docs/PLAN.md)
(the wider pipeline).

Live at `https://vc-job-scrapers.tfparsons.workers.dev`.

## Endpoints

| Endpoint | What it does |
|---|---|
| `GET /healthz` | `{"ok": true, "version": "2.0.0", "deploy_id": "..."}`. `deploy_id` changes on every deploy. |
| `GET /consider?host=<board host>` | Consider.com boards. Two requests per board: the board page for cookies and a CSRF token, then one search per term. |
| `GET /getro?host=<board host>` | Getro boards. One HTML search per term, parsed for JobPosting cards. |

`host` must be on the allowlist in [src/allowlist.js](src/allowlist.js). Anything
else returns the normal envelope with `error: "host not allowed: ..."`.

### Consider boards (8)

`jobs.notion.vc`, `careers.balderton.com`, `jobs.phoenixcourt.vc`,
`jobs.hoxtonventures.com`, `jobs.anthemis.com`, `jobs.amadeuscapital.com`,
`careers.highlandeurope.com`, `jobs.sequoiacap.com`

### Getro boards (9)

`jobs.dawncapital.com`, `indexventures.getro.com`, `talent.seedcamp.com`,
`jobs.mmc.vc`, `talent.octopusventures.com`, `opportunities.northzone.com`,
`jobs.accel.com`, `careers.atomico.com`, `portfolio.joinef.com`

### Debug overrides

Every scraper endpoint accepts these. n8n calls with defaults.

| Param | Effect |
|---|---|
| `?terms=gtm,growth` | Replace the search terms for this call. |
| `?loc=all` | Disable the location filter. |
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
  "config": {"terms": ["gtm", "growth"], "location_keep": ["london", "uk", "remote"], "max_age_days": 7},
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
- `remote` is Consider's boolean flag. Getro has no flag, so it is null; Getro
  puts "Remote" in the location string instead.
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

## Provider config

[src/config.js](src/config.js) holds the search terms, the location keep-list,
the recency window, the User-Agent and the concurrency limits. Changing it is a
push.

Filter semantics live once in [src/lib/filter.js](src/lib/filter.js) and apply
to every scraper:

- **Terms**: search each term per board, union the results, dedupe on `link`.
- **Location**: keep if `location` is null or empty (deliberate: a no-location
  GTM Engineer at Framer was once dropped downstream), or any keep-list token
  appears in it case-insensitively, or the platform's `remote` flag is true.
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
| `getro: HTTP 503 for gtm` | Every term search failed; the first failure is shown. |
| `partial: 2/15 term fetches failed: ...` | Some searches timed out or errored; the listings from the rest are still returned. |
| `unhandled: ...` | A bug. The stack is in `wrangler tail`. |

## How to add a board

- **Consider or Getro**: add one line to `HOSTS` in
  [src/allowlist.js](src/allowlist.js) with the platform and a short `source`
  slug, push, and add a Sources row in Airtable whose Worker endpoint is
  `https://vc-job-scrapers.tfparsons.workers.dev/<platform>?host=<host>`.
  To tell the platforms apart: a Consider board's page source contains
  `"csrfToken"`, a Getro page contains `data-testid="job-list-item"` and
  "Powered by Getro".
- **Anything else**: a new module in `src/scrapers/`, a route in
  [src/index.js](src/index.js), a fixture in `test/fixtures/` and a test. Keep
  parsing functions pure (HTML or JSON in, listings out) so they can be tested
  without the network, and run the shared filter at the end.

Not covered and why:

- **83North** (`83north.com/open-positions/`): the page is a single paragraph
  listing two role titles with no links, companies or dates, and its ld+json
  has no JobPosting. There is nothing to scrape.
- **a16z**, **Molten**, **Eight Roads**: deferred spikes, see BRIEF.md.

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

Pushes to `main` deploy through Cloudflare's GitHub integration (Workers Builds).
To confirm a push landed, compare `deploy_id` from `/healthz` before and after,
or look for the Cloudflare check on the commit in GitHub.

If the integration is not connected: Cloudflare dashboard, Workers & Pages,
`vc-job-scrapers`, Settings, Builds, connect the `tfparsons/vc-job-scrapers`
repository on branch `main` with the default deploy command `npx wrangler deploy`.
The interim alternative is `npx wrangler login` followed by `npm run deploy`.

## Limits and politeness

- Free tier: 10 ms CPU per request and 50 subrequests. A board uses 15 to 18
  requests and a few milliseconds of CPU; the rest is waiting on the network,
  which does not count. Do not upgrade pre-emptively; the signal is "Script
  exceeded time limit" in the Cloudflare logs.
- Consider searches run 4 at a time and a board takes a few seconds. Getro
  searches run one at a time because Getro slows sharply and times out when
  hit in parallel; a Getro board takes 10 to 50 s end to end depending on the
  board's own speed. Each request has a 15 s timeout. Set the caller's HTTP
  timeout to 90 s.
- One pass per board per day, descriptive User-Agent, no retries.
- No state, no caching, no auth. The host allowlist is the abuse guard.

## Layout

```
src/
  index.js              router: /healthz, /consider, /getro; query overrides; envelope
  config.js             TERMS, LOCATION_KEEP, MAX_AGE_DAYS, USER_AGENT, concurrency
  allowlist.js          the 17 hosts and their platform / source slug
  scrapers/consider.js  session (cookies + CSRF), search per term, field mapping
  scrapers/getro.js     split-on-card parser, search per term
  lib/filter.js         dedupe on link, location keep-list, recency, counts
  lib/relative-date.js  "4 days" -> "2026-08-29"
  lib/cookies.js        Set-Cookie headers -> Cookie header
  lib/html.js           entity decoding, tag stripping
  lib/http.js           fetch with User-Agent and timeout; small worker pool
  lib/respond.js        the contract envelope; never-throw wrapper
test/
  fixtures/             saved board responses
  snapshots/            expected parser output
  *.test.js             node:test suites
```

Plain JavaScript ES modules, zero runtime dependencies, scraper files under
200 lines, plain hyphens everywhere.
