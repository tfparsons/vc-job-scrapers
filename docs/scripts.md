# The scripts: reference

The local scripts that build and keep Startup Universe, the company list the nightly run polls.
Read this before running or changing anything in `scripts/` or `enrich/`.
What Startup Universe is for, its fields and who writes them, are in `docs/system.md`.

Last reconciled against live: 7 October 2026.
None of this deploys.
Every script reads its keys from `.env` (git-ignored; never print it), supports a dry run, and skips rows it has already handled, so a rerun is cheap and safe.
Pilot on ten rows before any big run.

## The scripts

| Script | What it does | Rerun when |
|---|---|---|
| `coverage.mjs` | Pulls every board's company list through the Worker's `/companies`, matches Startup Universe rows on domain first and normalised name second, and writes Boards and Board coverage. Fills blank Domain, HQ and London status from the boards. | Boards added, or new domains resolved |
| `resolve-domains.mjs` then `apply-domains.mjs` | Finds a website for name-only rows through SerpApi and writes Domain after checking the site answers. Never overwrites an existing domain. | SerpApi quota resets (monthly) |
| `enrich.mjs` | The general enrichment loop: a recipe in `enrich/recipes/` names the rows that need a value, a gatherer collects evidence for all of them in code, a model judges in bulk only where needed, and `apply` routes answers by confidence. Recipes: `domain`, `domain-check`, `linkedin`. | A recipe's filter still matches rows |
| `ats-detect.mjs` | Visits each company's site and careers page, identifies its ATS and slug from host signatures in links, iframes, scripts and redirects, and verifies that the public feed answers. Writes ATS, ATS slug, Careers URL, Last verified, and a Notes line when nothing was found. | New domains resolved |
| `hq-from-feeds.mjs` | Reads each verified feed and sets UK status from where the company is actually hiring. | After ATS detection |
| `hq-enrich.mjs` | Companies House name match. Wrong too often on common names, so review-by-hand only. | Rarely |
| `dedupe-universe.mjs` | Merges rows sharing a domain, or a normalised name where one has no domain. Never merges two rows with different verified feeds. | After a bulk load |

The usual order after adding companies: resolve domains, coverage, ATS detection, UK status from feeds, then tick Poll on the London and UK rows by hand.

## Rules that shape them

- A name-only match to a board is trusted only when the row's investors include that board, or the name is long and unique across boards.
  Short names exist many times over.
- A slug guessed from the domain or company name is accepted only when the public feed answers.
  Poll must be trustworthy, because the nightly run polls every ticked row without checking.
- Nothing found is recorded (a dated Notes line, or `Couldn't fetch`), so the next run skips the row instead of searching it again.
- Politeness: a few domains at a time, a per-request timeout, a cap on requests per domain, a descriptive User-Agent.
- No agent browses per row.
  Evidence is fetched in code for every row in parallel; a model reads compact evidence files in bulk only where judgement is needed.
  The agent-per-row design it replaced cost thousands of tokens and a minute a row.

## Enrichment routing

`enrich.mjs apply` writes a high-confidence answer to the field, puts medium and low answers in a `<X> candidate` column with `<X> confidence` for review, and marks rows with nothing found as `Couldn't fetch`.
`promote` copies candidates Tim has marked Approved into the field.
Recipes with no review columns (select outputs such as Domain check) write the value directly.
State lives in Airtable, in the recipe's filter, not in files; `enrich/work/` is git-ignored scratch.
The loop, the pilot and how to add a recipe are in the `enrich` skill under `.claude/skills/`.

## Keys

| Credential | Used by |
|---|---|
| `AIRTABLE_TOKEN` | Every script |
| `SERPAPI_KEY` | `resolve-domains.mjs` (free tier is a small monthly quota; pass `--limit`) |
| Companies House key | `hq-enrich.mjs` |

The nightly run's own credentials (Airtable, Gmail) live in n8n, and the Worker's keys are Worker secrets; neither is in `.env`.
