# VC Job Scrapers - brief for Claude Code: Tier 1 boards + Tier 2 spikes

Date: 3 Sep 2026. From the Cowork coverage audit (project doc `gtme-sourcing-research.md`; the visual version is the "VC Boards Coverage Audit" artifact). Two sessions of work, in priority order. Nothing here changes the email contract or job-sweep.

## Why

Measured against the Roles Inventory, the 17 live boards see about 18% of the GTM-family UK roles that arrive via other channels, and about 43% of the ones at VC- or growth-backed startups (the only employers a board could ever carry). The investor tally behind the misses says no single fund closes the gap, but nine funds with existing Getro/Consider boards account for roughly 16 more employers, and YC for 6 on its own platform. Tier 1 below takes funded-startup coverage from ~43% to ~58% with config plus one allowlist edit. Tier 2 is two scraper modules.

## What Cowork already did (do not redo)

- 17 new rows in the Sources table (base `appv8Lxbh4kp6DoBv`, table `tbllOCr6yCJf4SkwU`), all with `Active` UNCHECKED, `Worker endpoint` and `Platform` filled, and a Notes line saying why. They stay inactive until the allowlist ships: a board whose host is not allowlisted returns `error: "host not allowed"`, and more than 5 erroring boards trips the abnormal-volume guard (FAILED email, nothing stamped), which would break the daily run.
- Verified the block: `GET /getro?host=positions.moonfire.com` currently returns `{"error":"host not allowed: positions.moonfire.com"}`.
- `Board ID` column exists on Sources (single line text). Point72's row carries `point72-ventures`.

## Session A - Tier 1 (allowlist + verify + activate), about half a session

### A1. Add the hosts to `src/allowlist.js`

All verified 2 Sep as Getro ("Powered by Getro", `/companies/<co>/jobs/<id>-<slug>` links) or Consider (React shell, `/api-boards`). Paste into `HOSTS`:

```js
  // --- Tier 1 adds, 3 Sep 2026 (coverage audit) ---
  // Getro
  "jobs.generalcatalyst.com": { platform: "getro", source: "generalcatalyst" },
  "portfoliojobs.partechpartners.com": { platform: "getro", source: "partech" },
  "talent.cherry.vc": { platform: "getro", source: "cherry" },
  "positions.moonfire.com": { platform: "getro", source: "moonfire" },
  "jobs.hvcapital.com": { platform: "getro", source: "hvcapital" },
  "jobs.headline.com": { platform: "getro", source: "headline" },
  "careers.crane.vc": { platform: "getro", source: "crane" },
  "jobs.pointnine.com": { platform: "getro", source: "pointnine" },
  "jobs.firstminute.capital": { platform: "getro", source: "firstminute" },
  "talent.backed.vc": { platform: "getro", source: "backed" },
  "jobs.outlierventures.io": { platform: "getro", source: "outlier" },
  "careers.speedinvest.com": { platform: "getro", source: "speedinvest" },
  // Consider
  "jobs.lsvp.com": { platform: "consider", source: "lightspeed" },
  "careers.creandum.com": { platform: "consider", source: "creandum" },
  "careers.playfair.vc": { platform: "consider", source: "playfair" },
  "jobs.gtmfund.com": { platform: "consider", source: "gtmfund" },
```

Optional, add-and-watch: `"jobs.techstars.com": { platform: "getro", source: "techstars" }` (4.8k listings, global, founder-role heavy; Cledara GTM Engineer was live on it). No Sources row exists for it yet; create one if you add it.

### A2. Consider boards hosted on consider.com (Point72)

Point72 Ventures has no vanity domain: the board lives at `https://consider.com/boards/vc/point72-ventures/jobs`. The current `scrapeConsider` builds `origin = https://{host}` and fetches `${origin}/jobs` for the session, then POSTs `${origin}/api-boards/search-jobs`. For hosted boards the session page is at the board path. Spike, bounded to an hour:

- Accept an optional `board=<id>` query param on `/consider`. When present, fetch the session page from `https://consider.com/boards/vc/<id>/jobs` (Referer the same), and read csrfToken + board object from that page exactly as today.
- Confirm where the search API lives for hosted boards: most likely still `https://consider.com/api-boards/search-jobs` with the same body shape (`board: {id, isParent}` from the page). Verify with one live call before writing code around it.
- Allowlist entry: `"consider.com": { platform: "consider", source: "point72", boardPath: "/boards/vc/point72-ventures" }` or equivalent; the Sources row endpoint is already `/consider?host=consider.com&board=point72-ventures`.
- If it does not fall out cleanly, drop it and say so in PLAN.md. It is two gap companies (Heidi Health, Nscale); not worth a session.

### A3. Verify live, then activate

For each new host: `curl 'https://vc-job-scrapers.tfparsons87.workers.dev/<endpoint>'` and check `counts.fetched > 0`, `error == null`, and that the London-filtered `listings` look right by eye (spot-check two or three). Then either tick `Active` on the matching Sources rows, or list the ones that passed so Tim can. Do not activate a board that errors.

Watch for on the volume boards (General Catalyst ~19k, Lightspeed ~15k, Speedinvest ~1.4k): Getro returns 20 cards per term, newest first, so on a big board `counts.fetched` will sit at 20 x terms and older matches are invisible. That is fine at daily cadence (the 7-day window is what matters) but note it in the README so nobody reads `fetched` as the board's total.

### A4. Docs

- README "how to add a board": mention the `Board ID` column and the `board=` param if A2 ships.
- PLAN.md: add the Tier 1 boards to the coverage table; record the coverage numbers (18% / 43% / ~58%) and the doc they came from.

## Session B - Tier 2 spikes (one scraper module each)

### B1. Y Combinator - Work at a Startup

The single biggest fund in the gap: six of the missed employers are YC-backed (Humaans, Solve Intelligence, Encord, Cerrion, Fleek, Saturn). `https://www.workatastartup.com/jobs` returns HTTP 406 to a plain fetch, which is usually a User-Agent or Accept-header check rather than a hard block; try a browser-like Accept header first. Then look for the data source the page itself uses: an internal JSON endpoint (the site is a Rails app with a JSON API behind its filters) or an Algolia index (YC's other properties use Algolia; look for `algolia` app id and search key in the page source). Filter server-side or client-side to UK / remote-Europe, or it floods.

Endpoint shape: `/yc?loc=...` returning the standard contract, `platform: "yc"`, `source: "ycombinator"`, `link` = the workatastartup job URL (stable). The April scaffold had a `/yc` stub; the v2 tree does not, so this is a fresh module under `src/scrapers/yc.js` plus a fixture test. Done when it returns contract JSON with a non-zero `counts.fetched` and the UK set contains at least one of the six companies above.

If it needs a headless browser, stop: that is out of scope for a Worker. Document the finding and drop it.

### B2. a16z

`https://jobs.a16z.com/jobs`: custom Next.js aggregator, ~19k jobs, links out to Lever/Greenhouse. Three gap companies (ElevenLabs, Pit, Fleek), US-heavy. Already the deferred spike in PLAN.md. Look for `__NEXT_DATA__` in the page or the XHR the page calls with a location filter. Keep the location filter strict. Lowest priority of the three; skip if B1 runs long.

### B3. Techstars (if not done in A1)

Plain Getro row. Add, run for a week, keep only if the London yield holds.

## Not in this brief

Tier 3, the per-company ATS poller over the Employers table (`/ashby?slug=`, `/greenhouse?slug=`, `/lever?slug=`, `/workable?slug=`, `/teamtailor?host=`), is the largest remaining block (~34 employers) and gets its own brief once Tier 1 is live and measured.

## Constraints (unchanged)

Polite scraper: one pass per board per day, the existing User-Agent, no tight retry loops. Zero runtime dependencies. Scraper files under 200 lines; shared logic in `lib/`. Never throw; failures go in `error`. Plain hyphens everywhere user-facing. No LLM calls.
