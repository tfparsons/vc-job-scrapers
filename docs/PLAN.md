# VC Job Sweeper - Project Plan (v2, 2026-09-02)

Supersedes the April plan. The April design had its own Claude triage step and a `Triaged` table; that duplicated Stage 2 of the job-hunt pipeline and is gone. This is now a **Stage 0 provider**: it puts a structured email in tfparsons87@gmail.com and the existing `job-sweep` skill takes it from there.

## Goal

Cover the VC portfolio job boards that email alerts cover badly or not at all, so on-lane roles (GTM Engineering first, Growth/Product close behind) at London-relevant VC-backed companies reach the Roles Inventory within a day of posting.

Evidence this is worth doing (2 Sep audit of the inventory vs the boards):

- Getro alert emails are preference-filtered and capped at 10 cards. Framer's GTM Engineer (Atomico board, 18 Aug) never arrived in any alert. The 20 Aug Accel alert said "17 new jobs" and rendered 10.
- Across just the 6 unsubscribed Getro boards, ~8 on-lane London/unspecified-location roles in 5 weeks never reached the inventory (Cakewalk GTM Engineer, Monq GTM Engineer, Supercritical GTM Engineer, Zopa Marketing Ops Lead, Kriya CRM & RevOps Manager, quantilope Sr Marketing Ops Manager, Soldo GTM BizOps Analyst, Signal Sciences Sales Ops Manager).
- The first Consider.com API call returned Triptease Revenue Operations Manager, London, 1 Sep - also not in the inventory.
- Estimate: 3-5 net-new on-lane roles per week, a 15-20% lift on the current ~25/week core-title volume, skewed to the exact titles Tim wants.

## Where it sits in the pipeline

```
[VC boards] -> [Cloudflare Workers scrape] -> [n8n: upsert state, compose email]
                                                    |
                                                    v
                                    tfparsons87@gmail.com inbox  <- Stage 0 boundary
                                                    |
                                                    v
                        [1] job-sweep (new sender + extractor) -> Roles Inventory -> [2] role-shortlist -> ...
```

Rules that follow from the system map (`job-hunt-system-map.md`):

- **Wide gate.** The scraper does not score, rank, or judge fit. It records what the board said, verbatim. Empty fields are fine; wrong fields are not.
- **The only discrimination is provider config**: which search terms to run and which locations to keep. That is the same decision a LinkedIn saved search encodes.
- **The inbox is the breakpoint.** Nothing writes to the Roles Inventory directly. job-sweep owns the parse, the dedupe, and the lifecycle.
- **Heavy data never transits the main agent.** The email carries a machine payload so the extractor is trivial and lossless.

## Board coverage (worked backwards from the 22)

| Boards | Platform | Mechanism | Status |
|---|---|---|---|
| Notion Capital, Balderton, Phoenix Court, Hoxton, Anthemis, Amadeus, Highland Europe, Sequoia (8) | Consider.com | GET board page for session cookies + CSRF token, then POST `/api-boards/search-jobs`. JSON response with canonical ATS URLs, ISO timestamps, normalised locations, remote flag, seniority. | Proven 2 Sep |
| Dawn, Index, Seedcamp, MMC, Octopus Ventures, Northzone, Accel, Atomico, Entrepreneur First (9) | Getro | GET `/jobs?q=<term>`, parse schema.org JobPosting microdata. 20 cards per response; a term loop gets past that. | Proven 2 Sep |
| 83North | Static HTML with ld+json | Plain fetch + ld+json parse | Trivial, unverified |
| a16z | Next.js aggregator | Spike: look for `__NEXT_DATA__` or an internal API | Deferred, US-heavy |
| Molten Ventures | Custom page referencing Getro | Spike: look for an embedded Getro network ID | Deferred |
| Eight Roads | Thrive (JS app) | Spike: look for an API; otherwise drop | Deferred, lowest value |

17 of 22 boards on two endpoints. The five spikes are not blockers.

v2 board additions to evaluate once live: Plural, Latitude, Kindred, Cherry, Creandum, Earlybird, LocalGlobe, Connect Ventures, Mosaic. Most will be Getro or Consider, so each is a Sources row, not code.

## Architecture

```
[n8n cron: daily 06:30 London]  (job-sweep runs daily; match it)
       |
       v
[Read active Sources from Airtable base "VC Job Sweeper"]
       |
       v
[Fan out: one HTTP GET per board to the Worker]
   /consider?host=jobs.notion.vc
   /getro?host=talent.seedcamp.com
   /static?board=83north
       |
       v   each returns {source, scraped_at, listings[], error}
[Upsert into Raw Listings keyed on link; set first_seen on insert, last_seen always]
       |
       v
[Select rows where first_seen = today]
       |
       v
[Compose "VC Boards Sweep - DD MMM YYYY" email: readable block per role + fenced JSON payload]
       |
       v
[Send to tfparsons87@gmail.com]
       |
       v
[Update Sources: last_scraped, listings_pulled, last_error]
```

### Responsibilities

| Concern | Where | Why |
|---|---|---|
| Fetch + parse boards | Cloudflare Workers (repo `vc-job-scrapers`) | Isolated, testable per board, free tier, no runtime to host |
| Provider config (terms, locations, recency) | Worker, driven by query params / a shared config module | One place; the Sources table only says which boards are active |
| State (what have we already emailed) | Airtable `Raw Listings` | Keeps the daily email to genuinely-new roles |
| Orchestration, email | n8n | Cron, fan-out, Airtable and Gmail nodes already there |
| Parse into inventory, dedupe, lifecycle | job-sweep | Existing contract; nothing new to invent |

## Provider config (the discrimination that email alerts can't express)

**Search terms** - run per board, results unioned, deduped on link. Mirrors the Stage 2 regex families so nothing on-lane is invisible before Stage 2 sees it (the filter-agreement invariant from job-sweep v16):

```
gtm, go-to-market, revops, revenue operations, sales operations, marketing operations,
martech, growth, lifecycle, crm, hubspot, salesforce, product manager,
forward deployed, solutions engineer
```

**Location keep-list** - keep if location matches any of: `London`, `United Kingdom`, `UK`, `Remote`, `EMEA`, `Europe`, or is **blank**. Blank is kept deliberately: Framer's GTM Engineer had no location and that is the class the alert filter dropped. Consider's `remote` flag counts as Remote.

**Recency** - keep if `posted_date` is within 7 days, or if no date is available (flag `posted_date: null`). Getro's relative dates ("4 days") are parsed against `scraped_at`; "1 month" and older are dropped.

Tuning these is a config change, not a code change. Start wide; Stage 1 adjacency and Stage 2 regex do the narrowing.

## Airtable (base `VC Job Sweeper`, `appv8Lxbh4kp6DoBv`)

### Changes from the April build

- **Delete** the `Triaged` table (`tbl2d8YL3XX1bCXuF`) - done 2 Sep; Airtable converted the Raw Listings link field into a stray `Triaged` text column that still needs deleting by hand.
- **Sources**: `Board ID` (single line text, reference only - the Worker reads Consider's id from the page) added 2 Sep. Still to do: add `Consider` to the `Platform` single select; set Platform per the coverage table above (Molten, 83North, a16z, Eight Roads = Custom). `Worker endpoint` becomes the full URL n8n calls, e.g. `https://vc-job-scrapers.tfparsons87.workers.dev/consider?host=jobs.notion.vc`.
- **Raw Listings**: `Link` is the upsert key. Add `Emailed on` (date) so a re-run on the same day cannot double-send.
- Views: keep two - `Failing sources` (Sources where Last error is not empty) and `Last 30 days` (Raw Listings by First seen). Drop the rest.

### Sources (config, Tim edits)

| Field | Notes |
|---|---|
| Name | VC name |
| URL | Board URL as given |
| Worker endpoint | Full Worker URL for this board |
| Platform | Consider / Getro / Custom / Unknown |
| Active | Uncheck to pause a board |
| Last scraped, Last error, Listings pulled (last run) | Written by n8n |

### Raw Listings (state)

| Field | Notes |
|---|---|
| Role title (primary), Company, Location, Posted date, Link, Seniority raw, Salary raw, JD snippet | Verbatim from the board |
| Source | Link to Sources |
| Dedupe key | `LOWER(Company|Role title)` no whitespace, computed by n8n (not the upsert key here; that is Link) |
| First seen, Last seen | Stamped by n8n |
| Emailed on | Date the row went out in a sweep email |

Airtable free tier is 1,200 rows per base. At maybe 30-60 new rows a day this fills in a month or so. Either archive rows older than 30 days on each run (n8n delete step) or move to the paid plan. Archive is the default.

## n8n workflow

**Trigger:** cron `30 6 * * *` (London) plus manual.

1. **Read Sources** where `Active = true`.
2. **Fan out** with Loop Over Items, HTTP Request to `Worker endpoint`, 20 s timeout, continue-on-fail.
3. **Normalise** each listing to the Raw Listings shape: compute Dedupe key, `first_seen = today` (only on insert), `last_seen = today`.
4. **Upsert** Raw Listings on `Link`.
5. **Select** rows where `First seen = today` and `Emailed on` is empty.
6. **Compose email** in a Code node (no LLM; the template is fixed). Format below.
7. **Send** via the send-email workflow `kMHUPutUOnxMWUzv` or a Gmail node on the tfparsons87 credential. To: tfparsons87@gmail.com. Subject: `VC Boards Sweep - DD MMM YYYY`.
8. **Stamp** `Emailed on = today` on the sent rows. Update Sources (last scraped, count, error).
9. **Zero-new days:** still send a two-line email ("0 new roles; 17 boards scraped, 0 failed") so the absence of a sweep is itself a signal, and so job-sweep's per-sender search behaves predictably.

**Abnormal-volume guard:** if total listings across all boards is under 20, or more than 5 boards error, send an error-style email instead ("VC Boards Sweep - FAILED - DD MMM YYYY") and do not stamp anything.

## Email contract

This is the interface between the two systems. We own the template, so it is built to be drift-proof: a readable block per role for Tim, and a **fenced JSON payload** the extractor reads. Anchor-first: every role carries its link. ASCII only, plain hyphens.

```
VC Boards Sweep - 03 Sep 2026
Boards: 17 scraped, 0 failed | New today: 6

1. GTM Engineer - Cakewalk
   Location: London, UK | Posted: 2026-09-02 | Seniority: Mid-Senior Level | Salary: n/a
   Link: https://talent.seedcamp.com/companies/cakewalk/jobs/91587943-gtm-engineer
   Source: Seedcamp (Getro)

2. Revenue Operations Manager - Triptease
   Location: London, England, United Kingdom | Posted: 2026-09-01 | Seniority: n/a | Salary: n/a
   Link: https://apply.workable.com/j/0B79C6EEB4
   Source: Notion Capital (Consider)

...

Failing sources: none

--- machine payload (do not edit) ---
```json
{"run_date":"2026-09-03","boards_scraped":17,"boards_failed":[],
 "listings":[
  {"company":"Cakewalk","title":"GTM Engineer","location":"London, UK","posted_date":"2026-09-02",
   "seniority":"Mid-Senior Level","salary_raw":null,"link":"https://talent.seedcamp.com/companies/cakewalk/jobs/91587943-gtm-engineer",
   "source":"Seedcamp","platform":"getro"},
  ...
 ]}
```
```

Field rules:

- `link` is the URL the board gives. For Consider that is the canonical ATS URL (`url`, without the utm suffix), which is what the shortlist wants for its `canonical_url == digest link` invariant. For Getro it is the board's listing page.
- `salary_raw` only when the board shows a whole-line compensation string. Otherwise null. Never inferred.
- `posted_date` ISO or null. `location` verbatim, null if absent.

## job-sweep integration (the other half; a separate skill-process job)

- `references/senders.csv` gains a row: sender = the sending address, label `VC Boards Sweep`, subagent group `lightweight` (bodies are small), `multi_role=true`, extractor `vcboards`.
- `scripts/extract.py` gains `vcboards`: locate the fenced JSON, `json.loads`, emit one row per listing with `source_label = "VC Boards (<source>)"`, `raw_link = link`, `posted_date`, `visible_salary = salary_raw`, `location`. Degrade loudly if the fence is missing or the JSON does not parse; never fall back to parsing the readable block.
- An extract prompt in `references/extract-prompts/vcboards.md` that says exactly that.
- `pipeline-defects.md` and the version string get the usual bump.

Sender identity (resolved 2 Sep, job-sweep v19): the email is self-sent from tfparsons87 (the send-email workflow is From-locked). `senders.csv` gained a `subject_filter` column so the per-sender search is `from:tfparsons87@gmail.com subject:"VC Boards Sweep"`; the catch-all also excludes that address. Verify on the first live run that the search finds the self-sent thread.

## Error handling

- Per-board failures are caught in the Worker (`error` populated, `listings: []`, HTTP 200). n8n writes `Last error`, continues.
- The email's "Failing sources" line lists any board with an error; two consecutive days on the same board gets a louder line.
- Consider CSRF or cookie changes will show as a 412 on every Consider board at once. Getro DOM changes will show as 0 listings across every Getro board at once. Both trip the abnormal-volume guard.

## Phases

1. **Worker scaffold** (Claude Code Session 1): repo, wrangler, `/healthz`, GitHub auto-deploy to `vc-job-scrapers.tfparsons87.workers.dev`.
2. **Consider endpoint** (Session 2): `/consider?host=` against a fixture, then live against all 8 boards.
3. **Getro endpoint** (Session 3): `/getro?host=` with the term loop, live against all 9 boards. Plus `/static?board=83north`.
4. **n8n workflow**: read Sources, fan out, upsert, compose, send. Dry-run to Tim first.
5. **job-sweep extractor**: senders row, `vcboards` extractor, extract prompt - drafted as job-sweep v19 (2 Sep). Run one sweep with the new sender and check the rows land as `new` with the right `source_label`.
6. **Airtable tidy**: delete Triaged, add Consider platform, `Emailed on`, archive step.
7. **Spikes** (optional): a16z, Molten, Eight Roads. Then the v2 board list.

## Cost

Cloudflare free tier (~20 requests/day). Airtable free with the 30-day archive. n8n existing plan. No LLM calls anywhere in this pipeline. Effectively zero.

## Decisions

1. No triage in this pipeline; Stage 2 does it. April `Triaged` table removed.
2. Daily cadence, new-only emails, zero-new days still send.
3. Inbox is the boundary; no direct inventory writes.
4. Dedicated GitHub repo `vc-job-scrapers` with Cloudflare Git integration; free tier.
5. 17 boards on two endpoints for v1; five custom boards deferred to spikes.
