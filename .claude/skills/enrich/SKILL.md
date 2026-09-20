---
name: enrich
description: Clay-style enrichment of an Airtable table, paid for in session tokens. Code gathers the evidence for every row in minutes, a model judges it in bulk only where judgement is needed, and answers are routed by confidence (high is written, the rest goes to a candidate column for Tim to review, nothing found is marked Couldn't fetch). Use when Tim says "run the <recipe> enrichment", "enrich <column>", "check the domains", "promote the approved candidates", or describes a new column he wants filled.
---

# Enrich an Airtable column

The rule that makes this fast: **no agent ever browses per row.** A script
fetches evidence for all rows in parallel (free, minutes). If the answer needs
judgement, subagents read compact evidence files with NO web tools and write
verdicts (about 400 tokens a row, 300 rows per agent). A 2,000-row column is
under an hour in one session. The old agent-per-row design cost 8,000 tokens
and 70 seconds a row and hit the web-search cap; do not rebuild it.

Runs from the repo (`vc-job-scrapers`) with node and open internet. In Claude
Code on Tim's Mac: `eval "$(/opt/homebrew/bin/brew shellenv)"` first. It needs
`AIRTABLE_TOKEN` in `.env`; never print that file. If the environment has no
node or blocks outbound requests (some Cowork sandboxes), say so and stop:
this job belongs in Claude Code.

## The loop

1. `node scripts/enrich.mjs status --recipe <name>`: rows still needing it.
2. `node scripts/enrich.mjs gather --recipe <name>` (`--limit 10` for a pilot).
   Writes `enrich/work/<name>/verdict-code.json` (rows decided in code) and
   `judge-N.json` chunks (rows needing a model). Many recipes need no model.
3. For each `judge-N.json`: `node scripts/enrich.mjs prompt --recipe <name> --chunk N`
   prints the judge prompt. Launch one subagent per chunk (model sonnet, in
   parallel, background) with exactly that prompt. Each writes `verdict-N.json`.
4. Read a sample of the verdicts yourself before writing: every negative one
   (Wrong, Suspect) and about 1 in 7 of the medium ones.
5. `node scripts/enrich.mjs apply --recipe <name> --dry-run`, read the tally,
   then without `--dry-run`. Routing:
   - high confidence and verified -> the output field, confidence `High`
   - medium / low with a value -> the candidate field, confidence `Medium` / `Low`
   - nothing found, or failed verification -> confidence `Couldn't fetch`
   - recipes with no review fields (select outputs like Domain check) write the value directly
6. Report: written, for review, couldn't fetch, plus anything odd.

State lives in Airtable, not on disk. A row needs work while it matches the
recipe's `filter`; apply always writes something that takes it out. To retry
rows, clear their confidence cell. `enrich/work/` is scratch and not committed;
`docs/data/enrich/<name>/applied-DATE.json` is the log and is.

## Tim's review

In Airtable, filter `<X> confidence` = Medium or Low, look at `<X> candidate`,
and set confidence to `Approved` (or `Rejected`). Then
`node scripts/enrich.mjs promote --recipe <name>` copies approved candidates
into the real field and marks them High.

## Recipes (`enrich/recipes/<name>.json`)

`filter`, `inputs` (fields the judge sees), `gather` (which gatherer and its
settings), `judge` (`model` or `none`), `instruction` (for the judge),
`output` (field, type `domain | select | url | text`), `review`
(`candidateField`, `confidenceField`; omit to write directly), `notes`.

| Recipe | Gatherer | Judge | Measured |
|---|---|---|---|
| `domain-check` | `homepage`: title and description of the stored domain | model | 1,831 rows: 4 min fetch, 5 agents about 10 min |
| `domain` | `domain-candidates`: name-based host guesses + Clearbit autocomplete, each candidate's homepage read | model | 482 rows: 14 min fetch, 3 agents about 9 min; 64 high, 170 for review, 248 couldn't fetch |
| `linkedin` | `homepage-links`: the LinkedIn link on the company's own homepage | none | 15-row pilot: 3 s, 9 found |

Gatherers live in `scripts/lib/gather.mjs`. Each is about 20 lines and returns
either `evidence` (for the judge) or a finished `verdict`.

## A new enrichment

Ask what column Tim wants and which existing fields it can lean on. Then pick
the cheapest route that works, in this order:

1. **It is on the company's own site** (LinkedIn, X, careers page, pricing
   page, ATS): `homepage-links` with a new `pattern`, judge `none`. New recipe
   JSON only, no code.
2. **It can be judged from site text** (is it B2B, is it subscription, what
   sector): `homepage` evidence (add a path like `/pricing` if needed) and a
   judge `instruction`. New recipe JSON only.
3. **It needs an outside source** (Crunchbase, funding, headcount): add a
   gatherer that calls a free endpoint or guesses a URL and checks it. Sites
   that block scripts (Crunchbase, LinkedIn itself) cannot be verified by
   fetch: write guesses as Medium candidates, never High.
4. **Only web search can find it**: last resort, for the residue only. Web
   search is capped at about 200 calls per session across all subagents.

Create the output, candidate and confidence fields in Airtable (confidence
choices: High, Medium, Low, Couldn't fetch, Approved, Rejected). Pilot with
`--limit 10`, show Tim the verdicts, and run the full table only after he
says yes.

## Practical limits

- Fetch concurrency above about 20 floods the local DNS resolver and fakes
  "site not found". The gather step retries failures at 6 then 3 at a time.
- DuckDuckGo's HTML endpoint blocks scripts at volume. Clearbit autocomplete
  is free and keyless, but match its company name against ours.
- An acquirer's site is not the company's domain. A short common-word name
  (Boost, Twig) is never better than Medium.
- After new domains land: `domain-check`, then `coverage.mjs`,
  `ats-detect.mjs --all`, `hq-from-feeds.mjs`, then tick Poll where a
  supported ATS, slug and UK status line up.
