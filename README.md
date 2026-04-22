# vc-job-scrapers

Cloudflare Workers that scrape VC portfolio job boards and return normalised JSON. Called weekly by an n8n orchestrator, which writes the results to Airtable, runs a Claude triage step, and emails a shortlist.

This repo's responsibility ends at "return good JSON from a URL". Everything downstream (storage, dedupe, triage, email) lives in n8n and Airtable.

## Endpoints

| Path | Status | Notes |
| --- | --- | --- |
| `GET /healthz` | live | Returns `{"ok": true}`. Used by n8n to check the Worker before a sweep. |
| `GET /getro?host=<host>` | stub | Generic Getro scraper. Host must be on the allowlist. |
| `GET /thriver?host=<host>` | stub | Eight Roads (Thriver). |
| `GET /yc` | stub | Y Combinator jobs. |
| `GET /a16z` | stub | Andreessen Horowitz jobs. |
| `GET /sequoia` | stub | Sequoia Capital jobs. |

Stubs return the contract-shaped JSON below with `error: "not implemented yet"` and an empty `listings` array, so n8n sees a consistent shape from day one.

## Output contract

Every scraper endpoint returns:

```json
{
  "source": "dawncapital",
  "scraped_at": "2026-04-22T07:00:00Z",
  "listings": [
    {
      "company": "Qogita",
      "role_title": "Key Account Manager (Enterprise)",
      "location": "Amsterdam, Netherlands; Netherlands",
      "posted_relative": "1 day",
      "posted_date": "2026-04-21",
      "seniority": "Mid-Senior Level",
      "salary_raw": null,
      "link": "https://jobs.dawncapital.com/companies/qogita/jobs/75515818-key-account-manager-enterprise",
      "jd_snippet": null
    }
  ],
  "error": null
}
```

Rules:
- `listings` is always an array (never null).
- `error` is `null` on success, or a short string on failure.
- Endpoints never throw. Unexpected failures return HTTP 200 with a populated `error` field.
- `posted_date` is derived from `posted_relative`; null if unparseable.
- `salary_raw` and `location` are preserved verbatim from the board.

## Local development

```
npm install
npm run dev          # boots wrangler dev on http://localhost:8787
curl localhost:8787/healthz
```

## Deploy

First-time deploy (from local):

```
npx wrangler login   # one-time; browser OAuth
npm run deploy       # deploys to vc-job-scrapers.tfparsons.workers.dev
```

After the first deploy, pushes to `main` auto-deploy via the Cloudflare GitHub integration.

## Secrets

```
npx wrangler secret put ANTHROPIC_API_KEY
```

Used by the Tier-3 Claude-extraction fallback for JS-rendered custom boards. Not needed for Getro-powered boards.

## Adding a new scraper

1. Create `src/scrapers/<name>.js` exporting an `async function scrape<Name>(opts)` that returns `{ listings: [...] }`.
2. Import it in `src/index.js` and add the route to `SCRAPER_ROUTES`.
3. Save a fixture HTML file to `test/fixtures/<name>-jobs.html` and a known-good JSON snapshot to `test/snapshots/<name>-jobs.json`.
4. Wire the test into `test/test.js`.
5. Push - Cloudflare auto-deploys.

Use `src/lib/normalise.js` -> `contractShape()` to build the response body so every scraper produces the same JSON shape.

## Layout

```
src/
  index.js                Router + /healthz.
  allowlist.js            Allowed hosts for /getro.
  scrapers/               One file per board/platform.
  lib/
    normalise.js          Shared JSON contract builder + User-Agent constant.
    parse-relative-date.js  "1 day" -> ISO date.
    claude-extract.js     Tier-3 Claude fallback helper.
test/
  fixtures/               Saved HTML from each board.
  snapshots/              Known-good JSON snapshots.
  test.js                 Runs the parsers against fixtures and diffs against snapshots.
wrangler.toml
package.json
```

## Constraints

- JavaScript (not TypeScript) for v1.
- Parse HTML with `HTMLRewriter` (Workers built-in). Avoid heavy deps.
- Keep each scraper file under 200 lines. If it grows past that, extract helpers into `lib/`.
- User-Agent is set via `USER_AGENT` in `src/lib/normalise.js`. Use it on every outbound fetch.
- Plain hyphens only. No en-dashes or em-dashes in user-facing strings.

## Links

- Cloudflare Workers: https://developers.cloudflare.com/workers/
- HTMLRewriter: https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/
- Wrangler: https://developers.cloudflare.com/workers/wrangler/
