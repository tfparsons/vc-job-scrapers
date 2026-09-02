# VC Job Scrapers - Claude Code Project Brief (v2, 2026-09-02)

Supersedes the April brief. Two scraper endpoints instead of three tiers; no Claude-in-the-Worker fallback; no Anthropic API key. The parsing patterns below were validated against the live boards on 2 Sep 2026 - start from them, do not rediscover the DOM.

## What you're building

Cloudflare Worker endpoints that fetch VC portfolio job boards, apply a small provider config (search terms, location keep-list, recency), and return clean JSON. An orchestrator (n8n, external) calls each endpoint daily, keeps state in Airtable, and emails a digest that a downstream skill parses. This repo's job ends at "return good JSON from a URL".

Out of scope here: state, dedupe, email, scoring, anything with an LLM.

## User context

- Tim Parsons, London-based PM / GTM Engineer, between roles. He consumes the downstream email, not these endpoints.
- Non-technical but technically literate. Clear code and sensible defaults over cleverness. He does not write code; he reads it.
- Existing stack: Cloudflare (subdomain `tfparsons87.workers.dev`), n8n cloud, Airtable, GitHub. This repo deploys to `vc-job-scrapers.tfparsons87.workers.dev`.

## Output contract

Every endpoint returns HTTP 200 with this shape. Never throw; put failures in `error`.

```json
{
  "source": "seedcamp",
  "platform": "getro",
  "scraped_at": "2026-09-03T06:30:00Z",
  "config": {"terms": ["gtm","growth"], "location_keep": ["london","uk","remote"], "max_age_days": 7},
  "listings": [
    {
      "company": "Cakewalk",
      "title": "GTM Engineer",
      "location": "London, UK",
      "posted_date": "2026-09-02",
      "posted_relative": "1 day",
      "seniority": "Mid-Senior Level",
      "salary_raw": null,
      "remote": null,
      "link": "https://talent.seedcamp.com/companies/cakewalk/jobs/91587943-gtm-engineer",
      "matched_terms": ["gtm"]
    }
  ],
  "counts": {"fetched": 97, "after_location": 41, "after_recency": 6},
  "error": null
}
```

Rules:

- `listings` is always an array. `error` is null or a short string.
- Fields are verbatim from the board. Never reformat `location`. Never infer `salary_raw`; only populate it when the board shows a whole-line compensation string. Empty is safe, wrong is dangerous - the downstream sweep hard-excludes on bad salaries.
- `posted_date` is ISO `YYYY-MM-DD` or null. Getro gives relative dates; parse "N days"/"N hours" against `scraped_at`, leave "N months" and older as null with `posted_relative` set.
- `link` is what the board links to. For Consider use the `url` field (canonical ATS URL, no utm suffix). For Getro it is the board's own listing page. Downstream treats `link` as the identity of the role, so it must be stable run to run.
- `counts` is for debugging the filters; include it.

## Provider config (shared module, `src/config.js`)

```js
export const TERMS = [
  "gtm", "go-to-market", "revops", "revenue operations", "sales operations",
  "marketing operations", "martech", "growth", "lifecycle", "crm", "hubspot",
  "salesforce", "product manager", "forward deployed", "solutions engineer",
];
export const LOCATION_KEEP = ["london", "united kingdom", "uk", "remote", "emea", "europe"];
export const MAX_AGE_DAYS = 7;
```

Filter semantics (implement once in `src/lib/filter.js`, used by every scraper):

- **Terms:** search each term per board, union the results, dedupe on `link`, record which terms matched.
- **Location:** keep if `location` is null/empty (deliberate - the downstream alert filters dropped a no-location GTM Engineer at Framer), or if any keep-list token appears in it case-insensitively, or if a platform `remote` flag is true.
- **Recency:** keep if `posted_date` is null, or within `MAX_AGE_DAYS` of `scraped_at`.

Every endpoint accepts overrides for debugging: `?terms=gtm,growth`, `?loc=all` (disable location filter), `?days=30`. n8n calls with defaults.

## Endpoint 1: `/consider?host=<board host>` (8 boards)

Consider.com boards are client-rendered React; the HTML has no listings. They expose a search API guarded by a CSRF token that is printed in the page. Two requests:

**Request 1 - GET `https://{host}/jobs`.** Capture (a) the `Set-Cookie` headers (`session`, `session.sig`, `AWSALBAPP-*`) and (b) the CSRF token and board id from the HTML:

```
"csrfToken":"DCrUqWUA-X8fL5Ev3vFfZIZwHWuIrUw9ih68"
"board":{"id":"notion-capital","isParent":true}
```

Both are inside a JSON blob in a script tag; a regex on the raw HTML is fine.

**Request 2 - POST `https://{host}/api-boards/search-jobs`** with headers `Content-Type: application/json`, `x-csrf-token: <token>`, `Origin: https://{host}`, `Referer: https://{host}/jobs`, and `Cookie:` rebuilt from request 1's cookies (Workers `fetch` keeps no jar - read `response.headers.getSetCookie()` and join `name=value` pairs with `; `). Body:

```json
{"meta":{"size":100},"board":{"id":"notion-capital","isParent":true},"query":{"promoteFeatured":true,"query":"gtm"}}
```

Response: `{ total, jobs: [...], meta: { size, sequence } }`. Results come newest-first; 100 covered three weeks on Notion's board, so one page per term is enough for a 7-day window. If you ever need page 2, POST again with `meta.sequence` set to the previous response's value (verified: no overlap).

Job record fields to map:

| Contract field | Consider field |
|---|---|
| company | `companyName` |
| title | `title` |
| location | `locations` joined with "; " (verbatim), null if empty |
| posted_date | `timeStamp` (ISO) truncated to date |
| seniority | `jobSeniorities` joined, null if empty |
| salary_raw | null unless a compensation field is present as a whole string (none seen so far) |
| remote | `remote` boolean |
| link | `url` (canonical ATS link; `applyUrl` carries a utm suffix - do not use) |

Errors: a `412 {"error":"INVALID_CSRF"}` means the token or cookies were not carried; surface it in `error` and return `listings: []`. Wrong `host` returns an HTML 404 page; detect non-JSON and report it.

Hosts (all verified Consider on 2 Sep): `jobs.notion.vc`, `careers.balderton.com`, `jobs.phoenixcourt.vc`, `jobs.hoxtonventures.com`, `jobs.anthemis.com`, `jobs.amadeuscapital.com`, `careers.highlandeurope.com`, `jobs.sequoiacap.com`. Board id is read from the page, so the Sources table does not need to store it.

## Endpoint 2: `/getro?host=<board host>` (9 boards)

Getro boards are server-rendered with schema.org JobPosting microdata. One GET per term: `https://{host}/jobs?q={term}`. Each response contains up to 20 cards (the page says "Showing 110 jobs" and infinite-scrolls the rest; do not chase it - the term loop is the coverage mechanism).

Each card is delimited by `data-testid="job-list-item"`. Inside it, in order:

```html
<meta itemProp="description" content="GTM Operations Lead at Zinc"/>
<h4 ...><a ... href="/companies/zinc-3/jobs/91587943-gtm-operations-lead#content" data-testid="job-title-link">
  ... <span class="... job-title-text"><span ...>GTM Operations Lead</span></span> ...
<meta itemProp="name" content="Zinc"/>
<meta itemProp="addressLocality" content="London, UK"/>
<meta itemProp="datePosted" content="2026-09-01..."/>
```

Plus free text for the relative date ("1 day", "4 days", "1 month"), sometimes a seniority string ("Mid-Senior Level", "Senior", "Entry Level"), and sometimes a salary string ("USD 125k-165k / year + Equity").

Map: company = `itemProp="name"`, title = the `job-title-text` span (fall back to `description` minus " at <company>"), location = `addressLocality` (null if absent), posted_date = `datePosted` (else parsed from the relative text), link = `https://{host}` + the href with `#content` stripped. Use `HTMLRewriter` if it stays readable; the reference implementation below is regex-per-card and was adequate, so a split-on-marker + regex approach is acceptable here despite the general HTMLRewriter preference. Cards are small.

Guard: if a response contains "Powered by Getro" but zero cards for every term, that is a DOM change - report `error: "getro: 0 cards on all terms (DOM change?)"`.

Hosts (all verified Getro on 2 Sep): `jobs.dawncapital.com`, `indexventures.getro.com`, `talent.seedcamp.com`, `jobs.mmc.vc`, `talent.octopusventures.com`, `opportunities.northzone.com`, `jobs.accel.com`, `careers.atomico.com`, `portfolio.joinef.com`.

Keep a host allowlist for both endpoints (`src/allowlist.js`) so the Worker cannot be used to fetch arbitrary sites.

## Endpoint 3: `/static?board=83north` (1 board)

`https://www.83north.com/open-positions/` is static HTML with `application/ld+json`. Parse any `JobPosting` objects; if none, fall back to reporting the page as unparsed. Unverified beyond "the page has ld+json"; treat as a half-session task.

## Deferred spikes (not v1)

- **a16z** (`jobs.a16z.com`, Next.js): look for `__NEXT_DATA__` or the XHR the page makes. US-heavy; low priority.
- **Molten** (`moltenventures.com/opportunities`): page references getro.com; look for an embedded Getro network id or iframe.
- **Eight Roads** (`eightroads.thriveapp.ly`, Thrive): 398-byte shell; look for the API. Drop if painful.

## Reference implementation (Python, validated 2 Sep)

This is what proved the parsing. Port the logic; do not port the language.

```python
# Getro card parse
cards = html.split('data-testid="job-list-item"')[1:]
for c in cards:
    title = re.search(r'job-title-text">(?:<span[^>]*>)?([^<]+)', c)
    company = re.search(r'itemProp="name" content="([^"]+)"', c)
    loc = re.search(r'itemProp="addressLocality" content="([^"]+)"', c)
    posted = re.search(r'itemProp="datePosted" content="([^"]+)"', c)
    href = re.search(r'href="(/companies/[^"]+/jobs/[^"#]+)', c)

# Consider two-step
page = GET f"https://{host}/jobs"             # keep Set-Cookie headers
token = re.search(r'"csrfToken":"([^"]+)"', page.text).group(1)
board = re.search(r'"board":(\{"id":"[^"]+","isParent":(?:true|false)\})', page.text).group(1)
POST f"https://{host}/api-boards/search-jobs"
     headers = {Content-Type: application/json, x-csrf-token: token,
                Origin: https://{host}, Referer: https://{host}/jobs, Cookie: <joined>}
     body = {"meta":{"size":100}, "board": json.loads(board), "query":{"promoteFeatured":true,"query":term}}
```

## `/healthz`

`GET /healthz` returns `{"ok": true, "version": "<git sha or package version>"}`.

## Tech stack

- Cloudflare Workers, plain JavaScript (ES modules). TypeScript later if the codebase grows.
- Zero runtime dependencies. `HTMLRewriter` or split+regex for Getro; `fetch` + JSON for Consider.
- Wrangler, deployed by Cloudflare's GitHub integration on push to `main`.
- Tests: `test/fixtures/` holds one saved Getro HTML page and one saved Consider JSON response per board family; `test/test.js` runs the parsers against fixtures and diffs against `test/snapshots/*.json`. Also fixture-test the filter module (location keep-list, relative-date parsing) since those are where silent drops would come from.
- No secrets. There is nothing to store.

## Repo layout

```
vc-job-scrapers/
├── src/
│   ├── index.js            # router: /healthz, /consider, /getro, /static
│   ├── config.js           # TERMS, LOCATION_KEEP, MAX_AGE_DAYS
│   ├── allowlist.js
│   ├── scrapers/
│   │   ├── consider.js
│   │   ├── getro.js
│   │   └── static83north.js
│   └── lib/
│       ├── filter.js       # location + recency + term-union/dedupe
│       ├── relative-date.js
│       ├── cookies.js      # Set-Cookie -> Cookie header
│       └── respond.js      # contract envelope, never-throw wrapper
├── test/ (fixtures, snapshots, test.js)
├── wrangler.toml
├── package.json
├── README.md
└── BRIEF.md                # this file
```

## Session plan

1. **Scaffold.** Repo, `wrangler.toml`, `/healthz`, GitHub to Cloudflare auto-deploy. Done when `curl https://vc-job-scrapers.tfparsons87.workers.dev/healthz` returns ok.
2. **Consider.** `consider.js` against a saved fixture, then live against `jobs.notion.vc`, then all 8 hosts. Done when each returns contract JSON with a non-zero `counts.fetched` and the London-filtered set looks right by eye.
3. **Getro.** `getro.js` with the term loop and filter module, against a Dawn fixture, then all 9 hosts. Same done criteria. Add `/static` for 83North in the same session if time allows.
4. **Hardening.** Fixture tests for every parser and the filter module; the Getro zero-cards guard; the Consider non-JSON guard; README with "how to add a board" (a Sources row for Consider/Getro; a new scraper module otherwise).
5. **Spikes** (optional, one each): a16z, Molten, Eight Roads.

Build the plumbing before perfecting parsers: a deployed `/consider` that returns real JSON for one board is worth more than a perfect parser that is not deployed.

## Constraints and taste

- Workers CPU limit counts JS execution only, not `fetch` wait time. Free tier is fine at ~20 invocations a day. Do not upgrade pre-emptively; the signal to upgrade is "Script exceeded time limit" in Cloudflare logs.
- Be a polite scraper: one pass per board per day, descriptive User-Agent `VC-Job-Scrapers/2.0 (personal job search tool; github.com/tfparsons87/vc-job-scrapers)`, no retries in a tight loop.
- No en-dashes or em-dashes anywhere user-facing (README, error strings). Plain hyphens.
- Keep scraper files under 200 lines; push shared logic to `lib/`.
- No state, no caching, no auth (host allowlist is the abuse guard), no LLM calls.

## Definition of done (v1)

- `/healthz` ok; auto-deploy on push works.
- `/consider` returns contract JSON for all 8 hosts; `/getro` for all 9; `/static` for 83North or a documented reason it does not.
- Filter module unit-tested; every scraper has a fixture test.
- README explains the contract, the config, and how to add a board.
