---
name: enrich
description: Clay-style Airtable enrichment paid for in session tokens. Runs one batch of a named recipe (domain, domain-check, or a new one Tim describes), researching rows with subagents and writing verified answers back. Use when Tim says "run the next <recipe> batch", "enrich <column>", "check the domains", or describes a new column he wants filled from web research. One batch per session; a fresh session continues from disk.
---

# Enrich one batch

Web search is capped at about 200 calls per session, shared across subagents.
So a session does one batch (100 to 120 rows), saves everything to disk as it
goes, applies verified answers, and stops. The next session picks up from
the files. Page reads (WebFetch) are not capped the same way, so recipes that
read a known site instead of searching can use bigger batches.

Everything runs from the repo: `/Users/Parsnip/Documents/VC Job Scrapers/vc-job-scrapers`
after `eval "$(/opt/homebrew/bin/brew shellenv)"`. Batches and answers live in
`docs/data/enrich/<recipe>/` and are committed, so any machine or session sees
the same state.

## Recipes

`enrich/recipes/<name>.json`: base, table, `filter` (Airtable formula for rows
that need the value), `inputs` (fields the researcher sees), `output` (field,
type `domain` | `select` | `url` | `text`, options for select), `notes` field,
`instruction`, `searchesPerRow`, `batchSize`, `minConfidence`.

Existing: `domain` (find a website, 1 search per row), `domain-check` (read the
site, judge whether it is this company, 0 to 1 searches per row).

**New recipe:** when Tim describes a column, draft the JSON (create the output
field in Airtable first if it does not exist), export 10 rows, run one agent,
show Tim the answers, and only then run full batches.

## Loop

1. `node scripts/enrich.mjs status --recipe <name>`
2. `node scripts/enrich.mjs export --recipe <name>` (add `--size 10` for a pilot)
3. `node scripts/enrich.mjs prompt --recipe <name> --batch <batch file> --from A --to B --out <out file>`
   Split the batch into chunks of about 35 and launch one subagent (model
   sonnet, `run_in_background: true`) per chunk with the printed prompt,
   prefixed with the repo path and "use the Write tool; do not spawn other
   agents". Outputs are `out-<batch>-<chunk>.json` in the recipe's directory.
   Wait for all; if any reports budget exhaustion, launch no more this session.
4. `node scripts/enrich.mjs apply --recipe <name> --dry-run`, read the tally,
   then run it without `--dry-run`. It verifies each answer (domain must
   resolve, select must be an allowed option, url must match), writes only
   confident verified values, never overwrites, and appends a dated evidence
   line to Notes. Answers marked "not searched" go back into the queue.
5. Report: rows exported, written, rejected, low confidence, still to do;
   flag anything Tim should look at (Wrong / Suspect domains, exits, rebrands).
   Remind Tim the next batch needs a fresh session, or a Cowork scheduled task
   if he wants it hands-off.

## After a domain batch

New domains unlock the chain: `coverage.mjs`, `ats-detect.mjs --all`,
`hq-from-feeds.mjs`, then tick Poll on rows with a supported ATS, slug and UK
status. Domain-check answers of Wrong mean the Domain should be cleared and
the row re-queued for the domain recipe: do that by hand after Tim confirms.

## Cost and pace (pilot, 17 Sep 2026)

domain-check: about 8,000 tokens and 70 seconds per row for one agent. Three
agents in parallel make a 100-row batch roughly 40 minutes and 800k tokens.
