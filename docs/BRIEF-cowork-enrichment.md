# Brief for Cowork: build the Startup Universe domain dataset

Written 17 Sep 2026 by the Claude Code session that built the engine. Read
this first, then `.claude/skills/enrich/SKILL.md` and `scripts/enrich.mjs`.

## What this is

Tim keeps a table of about 2,470 startups ("Startup Universe") in Airtable.
The company **domain** is the anchor for everything downstream: job-board
coverage, ATS detection, nightly job polling. This is the one-off heavy lift
to get that anchor right. Tim pays in session tokens (Max plan) on purpose;
no paid APIs. After this pass the work shrinks to new rows only.

- Base: Employers/Opportunities `app4AILlddDnxgRpq`
- Table: Startup Universe `tbloPq3sVvuKuqjmm`
- Folder to work in: `/Users/Parsnip/Documents/VC Job Scrapers/vc-job-scrapers`

## The two jobs, in this order

1. **domain-check** (about 1,830 rows). Row has a Domain; is it really this
   company's site? Read the site with WebFetch, compare with Company, Sector,
   Investors, HQ. Write the single-select field `Domain check`: Confirmed,
   Suspect, Wrong or Unclear. Mostly page reads, few searches.
2. **domain** (about 480 rows at last count, shrinking as Tim's Airtable AI
   run lands). Row has no Domain and Stage is not Pre-seed or Exited. One
   web search per row to find the official site. The `AI assist` field may
   hold a suggested domain: if present, check that first with WebFetch and
   skip the search when it clearly is the company.

The exact filter, inputs, instruction and output for each live in
`enrich/recipes/domain-check.json` and `enrich/recipes/domain.json`. Those
files are the spec. Do not reword the instructions between runs.

## How one run works

One run = one batch, then stop.

1. `node scripts/enrich.mjs status --recipe <name>`. If 0 rows still to
   research, move to the next job; if both are 0, report "finished" and stop.
2. `export` a batch (100 rows; see limits below).
3. `prompt` prints the researcher prompt for a slice of the batch. Split the
   batch into chunks of about 35 and run one subagent per chunk in parallel.
   Each writes `docs/data/enrich/<name>/out-<batch>-<chunk>.json` as
   `[{id, value, confidence, evidence}]`.
4. `apply --dry-run`, read the tally, then `apply`. The script verifies each
   answer (domain must resolve, select must be an allowed option), writes
   only medium or high confidence, never overwrites a filled field, and adds
   a dated evidence line to Notes.
5. Report in five lines: exported, written, rejected, low confidence, still
   to do. List every Wrong and Suspect with its evidence.

**If node or outbound network is not available in your environment**, do the
same loop with the Airtable connector instead: list records with the
recipe's filter, research, update the output field and append the same dated
line to Notes (`YYYY-MM-DD: <recipe>: <value> (<confidence>): <evidence>`).
Still save the batch and answers as JSON in `docs/data/enrich/<name>/` so the
next run can see what is done.

## Limits that shape the schedule

- **Web search is capped at about 200 calls per session, shared with
  subagents.** A fresh session resets it. This is why one run does one batch.
- WebFetch is not capped the same way. domain-check is mostly WebFetch, so
  100 rows is safe and 150 is worth trying once a run has gone cleanly.
  The domain recipe uses a search per row: keep it at 100 to 120.
- Measured cost: about 8,000 tokens and 70 seconds per row. A 100-row batch
  with three parallel agents is about 40 minutes and 800k tokens.
- Scheduled tasks only fire while the Mac is awake and the app is open.

## Suggested schedule

Create one scheduled task, "Enrich next batch", whose prompt is: *"Read
docs/BRIEF-cowork-enrichment.md in the vc-job-scrapers folder and do one
run."* Each firing is a fresh session, so the search cap resets.

- Days 1 to 2: three runs a day (for example 09:00, 13:00, 17:00). Tim
  checks the reports and his usage meter.
- If clean and usage is comfortable: every three hours, 07:00 to 22:00.
  That is about 600 rows a day, so domain-check finishes in three to four
  days and the domain job a day after.
- Keep clear of 01:00 to 01:15 London, when the nightly n8n sweep writes to
  Airtable.
- When both jobs report 0 remaining, disable the task and tell Tim.

## Rules

- One run at a time. If the newest `batch-NN.json` is under 90 minutes old
  and has no matching `out-` files, another run is in progress: stop.
- Never answer from memory. If a row could not be looked up, write value
  null with evidence "not searched"; it goes back in the queue.
- If the search budget runs out mid-batch, stop launching agents, apply what
  exists, and report.
- Never overwrite or clear `Domain`. Wrong and Suspect are flags for Tim; he
  decides the fix. Do not touch any other field or table.
- An acquirer's site is not the company's domain. For the domain job, an
  acquired company gets value null and evidence starting "Exited:"; a
  renamed company gets the new domain and evidence starting "Rebranded:".
- Never print, copy or move the contents of `.env`.
- Do not commit or push. Leave the files on disk; Claude Code commits them.

## Already known (from the 10-row pilot, 17 Sep)

8 Confirmed. Context Scout: Wrong (site is unrelated). KRY: Suspect (Domain
holds "livi", should be kry.co.uk). Both await Tim's decision.

## Later

The same engine takes any new column: write a recipe JSON, create the output
field, pilot 10 rows, show Tim, then schedule. Next candidates Tim has
named: LinkedIn company URL, subscription-business check, domains for a
second company list. Once domains are clean, the chain to run from Claude
Code is `coverage.mjs`, `ats-detect.mjs --all`, `hq-from-feeds.mjs`.
