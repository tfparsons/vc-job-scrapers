# VC Job Sweeper: system doc

What this system is, how it runs each night, where its state lives and the contracts that hold it together.
Read this before changing the n8n workflow, either Airtable base, or anything that crosses the boundary between the Worker and the rest.
For the Worker's endpoints and filters read `docs/worker.md`; for the scripts that build Startup Universe read `docs/scripts.md`.

Status: live.
Last reconciled against live: 7 October 2026.
Backlog: the Tasks table in the VC Job Sweeper base (IDs below).
Source of truth: the deployed Worker and `src/` win on behaviour; the n8n workflow and the two Airtable bases win on scheduling, state and config; this doc describes both and loses to either.

## Purpose, goals and non-goals

The system is Stage 0 of Tim's job hunt: everything that finds roles before the `job-sweep` skill sees them.
It exists so that on-lane roles (GTM engineering first, growth and product close behind) at London-relevant VC-backed companies reach the Roles Inventory within a day of posting, through boards and feeds that email alerts cover badly or not at all.

Goals:

- Every role on a watched board or feed that matches the search terms and the UK location rules reaches Tim's inbox once, the night after it is first seen.
- Adding a source is config plus at most an allowlist line, never a new pipeline.
- A bad night costs that night's missing sources, never the roles the other sources found.

Non-goals, and why:

- No scoring, ranking or fit judgement. That is Stage 2 (`role-shortlist`, `role-triage`) and duplicating it here produced two triage steps that disagreed.
- No direct writes to the Roles Inventory. The inbox is the boundary, so `job-sweep` owns the parse, the dedupe and the lifecycle, and this system can be rebuilt without touching them.
- No LLM calls anywhere in the nightly run. It must be free to run and deterministic to debug.

Tie-break: a wide gate.
When a filter is in doubt, keep the listing.
Empty fields are fine and wrong fields are not, because Stage 1 and Stage 2 narrow and nothing downstream can recover a role this system dropped.

## Architecture at a glance

The organising idea: configuration lives in Airtable, the Worker fetches, n8n orchestrates and keeps state, and an email is the hand-off.
Each part does one job, so a failure says where to look: the Worker never stores or emails, n8n never parses a job board, the skills never call the Worker.

| Part | Platform | Job |
|---|---|---|
| Sources of roles | Airtable, two bases | Which VC boards, company ATS feeds and keyword sources are watched, and whether each is switched on |
| Fetching | Cloudflare Worker `vc-job-scrapers` | One endpoint per platform; applies the search terms, location rules and recency window; returns the listings envelope; stateless |
| Orchestration and state | n8n workflow "VC Boards Sweep" | Reads the config, calls the Worker, dedupes, grades the night, upserts Raw Listings, emails, stamps, retries |
| Hand-off | Gmail, to Tim's own address | The "VC Boards Sweep" email: a readable list plus a fenced JSON payload that `job-sweep` parses |
| Company list | Airtable Startup Universe, built by the scripts | The companies whose ATS feeds the run polls |

Three kinds of source feed the same run and the same email:

- VC portfolio boards (Getro, Consider, Y Combinator, a16z), one Sources row each.
- Company ATS feeds (Ashby, Greenhouse, Lever, Workable, Teamtailor, Recruitee), one Startup Universe row each with Poll ticked.
- Keyword sources that search the whole market (Jobs by Workable, RevOps Careers, the Clay community feed), one Keyword Sources row each.

Email alerts from LinkedIn, Welcome to the Jungle and Built In are not part of this run.
They land in Gmail directly and `job-sweep` reads them through its senders list.

## The nightly run

n8n owns the schedule; read the two triggers there.
The sequence is what matters.

1. Read the config: Sources rows that are Active with a Worker endpoint; Startup Universe rows with Poll ticked, an ATS and an ATS slug; Keyword Sources rows that are Active, not email alerts, with a Worker endpoint.
2. Call the Worker, in three parallel branches.
   Boards are called a few at a time with a long gap and a long timeout, because Getro slows sharply under parallel load and a burst once timed out every board at once.
   Company feeds are called in small batches with a short gap, because Workable rate-limits a burst.
   Keyword sources get one call per line of the row's Keywords.
3. Write status back to the row each call came from: when it ran, the error if any, and how many listings it kept.
   This never stops the run.
4. Merge and dedupe on `link`.
   A role found on a board and on the company's own feed is one role.
5. Grade the night (see Monitoring).
   Whatever was collected is always stored and emailed; a failure only changes the label.
6. Upsert Raw Listings on Link, setting Last seen to today.
   A side branch stamps First seen on rows where it is blank.
7. Select the rows seen today that have never been emailed, and compose the email.
8. Send, then stamp Emailed on, then delete rows first seen more than 30 days ago.
9. Retry, from a second trigger a little over an hour later: re-call only the boards whose Sources row carries today's date and a non-partial error, store and email anything recovered under a RETRY subject, and update the same status and monitoring rows.
   Nothing failed, nothing sent.

*Design notes.*
New rows are selected by "Last seen today and Emailed on empty" rather than "First seen today", so the email never depends on the First seen stamp having run, a failed send is retried the next night, and a same-day re-run sends nothing twice.
The email is plain text so the fenced JSON survives untouched.
Dedupe on `link` rather than on company and title is what makes a board and a company feed agree about the same role.

## Data

### VC Job Sweeper base

The plumbing: config, state and monitoring.

| Table | Role | Who writes what |
|---|---|---|
| Sources | One row per VC board: Name, URL, Platform, Worker endpoint, Active, Board ID | Tim edits config. n8n writes only Last scraped, Last error and Listings pulled (last run). |
| Keyword Sources | One row per whole-market service, email alerts included: Type, Keywords (one phrase per line), Worker endpoint, Sender address, Active, Status | Tim edits config. n8n writes only Last run, Last error and Listings pulled (last run) on rows it calls. Email-alert rows are read by `job-sweep`, not by this run. |
| Raw Listings | Every listing seen, verbatim from the board, keyed on Link | n8n only: upsert on Link, First seen, Last seen, Emailed on, and the 30-day delete. Nothing else writes here. |
| Source Health | One row per source with a traffic light, upserted on Key | n8n rewrites the rows for boards, keyword sources, the company polls (one aggregate row) and the run itself. Rows for sources it does not touch (inactive, not built, email alerts) are kept by hand. |
| Run Log | Append-only history, one row per source per run | n8n only. Plot Status or Fetched over Run date to see a source degrade before it breaks. |
| Tasks | The backlog | Anyone. Owner "Decide" means it needs Tim's call before anyone acts. |

Raw Listings field notes:

- Link is the upsert key and the role's identity. Dedupe key (lowercased company and title, whitespace stripped) is computed by n8n and kept for reference only; it is not the match key.
- JD snippet and the stray Triaged column are unused leftovers from an earlier design. Never write to them.
- Rows are deleted 30 days after First seen. Whether to keep doing that is an open Tasks row; the base is on a paid plan, so the cap is not the reason.

### Employers / Opportunities base

The knowledge: Startup Universe, Employers, Roles Inventory and Application Tracker.
Only Startup Universe belongs to this system; the other three are the job-hunt skills' and are documented there.

Startup Universe is wide and thin: one row per company, deliberately separate from the curated Employers table, linked where they overlap.
It is built and enriched by the scripts (`docs/scripts.md`) and read by the nightly run.

| Field group | Fields | Written by |
|---|---|---|
| Identity | Company, Domain (the match key), HQ, London status, Stage, Sector, Investors | Scripts and Tim |
| Board coverage | Boards, Board coverage | `coverage.mjs` |
| ATS | ATS, ATS slug, Careers URL, Last verified | `ats-detect.mjs` and Tim |
| Polling | Poll (checkbox), Last polled, Last error, Listings pulled (last poll) | Tim ticks Poll. n8n writes the other three. |
| Review | `<X> candidate`, `<X> confidence` columns, Notes | `enrich.mjs`; Tim approves candidates |

*Design note.* Poll is the only field that decides whether a company is in the run, and it is ticked by hand after a feed is verified.
Two rows must never poll the same feed: the link dedupe would still hold, but every status write and health count would be doubled.

### Key identifiers

| Thing | ID |
|---|---|
| Worker | `https://vc-job-scrapers.tfparsons87.workers.dev` |
| n8n workflow "VC Boards Sweep" | `AQzbFqr1Pi0uyWMd` |
| VC Job Sweeper base | `appv8Lxbh4kp6DoBv` |
| Sources | `tbllOCr6yCJf4SkwU` |
| Raw Listings | `tblJVgGRbxFwZpIlQ` |
| Keyword Sources | `tblInj71uzN2NGOXx` |
| Source Health | `tblldeVKVwEj8P8Zb` |
| Run Log | `tblO5eqnH5fX2sc8K` |
| Tasks | `tbliXgrrxB88ZALW2` |
| Employers / Opportunities base | `app4AILlddDnxgRpq` |
| Startup Universe | `tbloPq3sVvuKuqjmm` |

## Components

| Component | Objective | Good looks like |
|---|---|---|
| Worker, board endpoints (`/getro`, `/consider`, `/yc`, `/a16z`) | Return every on-lane, UK-relevant, recent listing on one board, verbatim | Every term searched, `link` stable run to run, `salary_raw` null unless the board shows a compensation line, errors in the envelope and never in the HTTP status |
| Worker, ATS endpoints (`/ashby` and siblings) | Return one company's open roles from its public feed, filtered like a board | One feed GET, title matched on whole words, `link` the ATS's canonical job URL |
| Worker, keyword endpoints (`/workable-search`, `/rss`, `/adzuna`, `/reed`) | Search the whole market for a title phrase | Title contains the phrase or a config term; a missing key says so in `error` and fetches nothing |
| Worker, `/companies` | Return a board's full company list for the coverage pass | Not a job scraper; its own contract, see `docs/worker.md` |
| n8n, nightly branch | Collect from every active source, store once, email once | Every active row called and stamped; email sent even on a zero-new night; nothing stored twice |
| n8n, retry branch | Recover the boards the nightly branch lost | Only today's failed boards re-called; RETRY email only when something was recovered |
| n8n, health rows | Make a silent failure visible the next morning | Every source called has a Source Health row and a Run Log row, even when the write node errors |
| Scripts | Build and keep Startup Universe accurate enough that Poll can be trusted | Every polled slug feed-verified; no row polled twice; see `docs/scripts.md` |

Failure modes of the sequence:

- A Worker deploy that breaks a parser shows as that platform going Orange or Red across every board at once, and as a DEGRADED or FAILED email.
- A status write failing costs that row's stamp, never the listings; both monitoring write nodes continue on error.
- A send failing leaves Emailed on blank, so the rows go out the next night.
- The run skipping a night is silent apart from the missing email; nothing alerts on absence.

## Monitoring

After each run the workflow grades every source and the night itself, upserts Source Health and appends Run Log.

- Green: ran, no error, fetched something.
- Orange: partial errors, or fetched nothing (a site change usually looks like this).
- Red: failed.
- The company polls are one aggregate row: Red above a quarter failing, Orange above a few per cent, because a single dead slug is churn, not an outage.
- The night: `ok`, `degraded` when more than five boards failed, `failed` when fewer than 20 listings were collected across all sources.
  Only boards count towards `degraded`; polls and keyword failures are listed in the email and never change the grade.

The email subject carries the grade (`- DEGRADED -` or `- FAILED -` before the date), the warning goes first in the body so a bad night cannot be mistaken for a quiet one, and failed boards are named with a note that they will be retried.

*Design note.* An earlier guard threw the whole night away when more than five boards failed.
One slow Getro night discarded 210 good listings from the other sources, so the grade is now a label and the listings are always kept.

## Contracts and invariants

Each carries what breaks if it goes.

**The email payload is shared with `job-sweep`.**
Every email variant carries a fenced JSON block with `kind` (`nightly` or `retry`), `status`, `boards_scraped`, `boards_failed`, `boards_failed_platforms`, `boards_partial`, `retry_at`, the poll and keyword counts, and `listings`, each listing with `company`, `title`, `location`, `posted_date`, `seniority`, `salary_raw`, `link`, `source` and `platform`.
`job-sweep`'s `extract.py --format vcboards` reads exactly this and never falls back to the readable block.
Change its shape without a matching `job-sweep` change and VC-board rows silently stop reaching the Roles Inventory.
That change is Tim's call.

**The listings envelope is shared between the Worker and n8n.**
Its shape is defined in `docs/worker.md`; n8n's normalise nodes read `listings`, `counts.fetched` and `error`.
Rename a field on either side and the run stores nothing and reports Green.

**`link` is the role's identity.**
Raw Listings upserts on it, the run dedupes on it, `job-sweep` keys on it.
A parser change that alters how a link is formed re-emails every role on that platform as new and breaks the join between a board and the company's own feed.

**`salary_raw` is null unless the board shows a whole-line compensation string.**
The downstream sweep hard-excludes on salary, so an empty value is safe and a wrong one drops a good role.

**Empty location and empty date are kept.**
A no-location GTM Engineer was once dropped by an alert filter; the shared filter keeps missing data and only drops a listing when the board itself says it is a month or more old.

**The host allowlist is the abuse guard.**
The Worker is public and unauthenticated.
It fetches only allowlisted hosts, ATS slugs inside their own ATS's API URL, and RSS feeds by allowlisted name.
An endpoint that took an arbitrary URL would turn it into an open proxy on Tim's account.

**Allowlist before Active.**
A Sources row whose host is not yet deployed returns `host not allowed`, and enough of those turn the night DEGRADED.

**Status writes are the only writes outside Raw Listings and the monitoring tables.**
n8n writes three fields on Sources, three on Keyword Sources and three on Startup Universe, nothing else.
Any other write from the run would race the scripts and Tim's edits.

**The sender is Tim's own address.**
The email is self-sent, so `job-sweep` finds it by subject, not by sender.
Change the subject prefix and the sweep stops seeing the thread.

Unguarded: nothing checks that the run happened at all.
A skipped night is only visible as a missing email and a gap in Run Log.

## Open questions

- Adzuna and Reed are built in the Worker but not live: their Keyword Sources rows are inactive and neither key is set as a Worker secret.
  The Tasks rows for the keys are Tim's.
- Molten Ventures and Eight Roads have Sources rows but no scraper; both need a spike to find a feed, and Eight Roads is the lowest-value board.
- Whether to keep the 30-day delete of Raw Listings is a Decide row in Tasks.

## Change-to-doc map

| If you change | Check |
|---|---|
| A parser, a filter, the envelope | `docs/worker.md`, and Contracts above if `link`, `salary_raw` or the envelope shape moved |
| The n8n workflow's sequence, grading or email | The nightly run, Monitoring, and the email payload contract |
| A table or field in either base | Data, and the key identifiers table if an ID changed |
| A script or recipe | `docs/scripts.md` |
| What a source is or how it is switched on | Architecture at a glance |
