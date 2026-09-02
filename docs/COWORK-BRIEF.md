# VC Boards Sweep - brief for Cowork (job-sweep integration)

Date: 2 Sep 2026. Status: the upstream pipeline is live. This brief covers the one
remaining piece, which lives in the job-sweep skill, not in this repo.

## What now exists (do not rebuild)

- Cloudflare Worker `https://vc-job-scrapers.tfparsons87.workers.dev` scrapes 17
  VC portfolio boards (8 Consider.com, 9 Getro) and returns filtered JSON.
  Filters: search terms (gtm, revops, growth, product manager, etc), location
  London / UK / EMEA or UK-EU-friendly Remote, posted within 7 days.
- n8n workflow "VC Boards Sweep" (id `AQzbFqr1Pi0uyWMd`, folder VC Job Boards)
  runs daily at 06:30 London. It reads the Sources table in the Airtable base
  VC Job Sweeper (`appv8Lxbh4kp6DoBv`), calls every active board, upserts
  Raw Listings on Link, and emails the new roles. State (already-emailed) is
  kept in Airtable, so each email contains only roles not emailed before.
- First real email went out 2 Sep 2026 with 193 roles (day-one flood; normal
  days will be roughly 10 to 40).

## The email contract (what job-sweep has to parse)

Sent from `tfparsons87@gmail.com` to `tfparsons87@gmail.com`, sender name
"VC Boards Sweep", plain text (not HTML), ASCII only, plain hyphens.

Subject: `VC Boards Sweep - DD MMM YYYY` (e.g. `VC Boards Sweep - 02 Sep 2026`).

Body, in order:

```
VC Boards Sweep for 02 Sep 2026: 193 new roles; 17 boards scraped, 0 failed.

1. GTM Operations Lead - Zinc
   Location: London, UK / Posted: 2026-08-29 / Seniority: Mid-Senior Level / Salary: not stated
   Link: https://talent.seedcamp.com/companies/zinc-3/jobs/91587943-gtm-operations-lead
   Source: Seedcamp

2. ...

Failing sources:            (block only present when a board failed)
- Dawn Capital: getro: 0 cards on all terms (DOM change?)

Partial sources (some searches timed out, listings still included):   (optional)
- Accel: partial: 1/15 term fetches failed: ...

--- machine payload (do not edit) ---
```json
{"run_date":"2026-09-02","boards_scraped":17,"boards_failed":[],"listings":[{"company":"Zinc","title":"GTM Operations Lead","location":"London, UK","posted_date":"2026-08-29","seniority":"Mid-Senior Level","salary_raw":null,"link":"https://talent.seedcamp.com/companies/zinc-3/jobs/91587943-gtm-operations-lead","source":"Seedcamp","platform":"getro"}]}
```
```

Payload field rules:

- `link` is the identity of the role. For Consider boards it is the canonical
  ATS URL (Greenhouse, Ashby, Workable, etc, no utm suffix). For Getro boards
  it is the board's own listing page. Stable run to run.
- `location` is verbatim from the board, several locations joined with `; `,
  or null.
- `posted_date` is `YYYY-MM-DD` or null.
- `salary_raw` is only set when the board showed a whole-line compensation
  string (Getro's "Compensation:" line). Never inferred. Null otherwise.
- `seniority` is the board's own string or null.
- `source` is the VC name as in the Sources table. `platform` is `consider` or
  `getro`.

Two other email shapes to handle:

- Zero-new day: same subject, header line says `0 new roles`, no numbered
  block, payload has `"listings":[]`. Still a valid run; treat as "nothing new".
- Failed run: subject `VC Boards Sweep - FAILED - DD MMM YYYY`, no payload at
  all. The abnormal-volume guard tripped (fewer than 20 listings after filters
  or more than 5 boards failed). Degrade loudly; do not parse the readable text.

## What to build in job-sweep (plan phase 5)

1. `references/senders.csv`: add a row. Label `VC Boards Sweep`, subagent group
   `lightweight`, `multi_role=true`, extractor `vcboards`. Sender is
   `tfparsons87@gmail.com`, so the per-sender Gmail search must be
   `from:tfparsons87@gmail.com subject:"VC Boards Sweep"` and the catch-all's
   `-in:sent` scoping must not hide it. Verify on the first live run.
2. `scripts/extract.py`: add `vcboards`. Locate the fenced JSON after the
   `--- machine payload (do not edit) ---` marker, `json.loads` it, emit one row
   per listing: `source_label = "VC Boards (<source>)"`, `raw_link = link`,
   `posted_date`, `visible_salary = salary_raw`, `location`, `role_title = title`,
   `company`. If the fence is missing or the JSON does not parse, fail loudly;
   never fall back to parsing the readable block. A FAILED subject is a
   failed-run signal, not an extraction error.
3. `references/extract-prompts/vcboards.md`: the prompt for the lightweight
   extractor, mirroring the rules above.
4. `pipeline-defects.md` entry and version string bump.

Dedupe downstream is on `link`; the Roles Inventory already dedupes on
canonical URL, and Consider links are canonical ATS URLs so the shortlist's
`canonical_url == digest link` invariant holds.

## Things that will look odd and are by design

- The digest is a wide gate. Getro's search is fuzzy, so a "gtm" search can
  return a Talent Partner. Stage 2 (role-shortlist) does the judging.
- Multi-location roles that list London alongside US cities are kept.
- Some Consider boards return few or zero roles on a given day (Anthemis,
  Amadeus); that is real, not a failure.

## Where things are

- Worker repo: github.com/tfparsons/vc-job-scrapers (README explains the
  contract, filters, error strings, how to add a board).
- Design docs in that repo: BRIEF.md (Worker), docs/PLAN.md (pipeline).
- Pause one board: untick Active on its Sources row. Pause everything:
  deactivate the n8n workflow.
