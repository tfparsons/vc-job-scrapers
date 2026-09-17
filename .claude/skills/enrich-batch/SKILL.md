---
name: enrich-batch
description: Run one batch of Startup Universe enrichment (domains first) using web search inside this session, then write verified results to Airtable. Use when Tim says "run the next enrichment batch", "next domain batch", "enrich the next 100", or wants Clay-style enrichment done with session tokens rather than API credits. One batch per session; start a fresh session for the next.
---

# Enrich one batch

Web search in a session is capped at about 200 searches, shared across every
subagent. So each session does one batch of about 120 rows, saves everything
to disk as it goes, writes the verified results, and stops. The next session
picks up where this one left off. Nothing is lost if a session dies mid-batch.

All commands run from the repo: `/Users/Parsnip/Documents/VC Job Scrapers/vc-job-scrapers`,
after `eval "$(/opt/homebrew/bin/brew shellenv)"`. Batch files live in
`<scratchpad>/enrich/<need>/`; keep the same directory across sessions, so
copy it somewhere durable such as `docs/data/enrich/` if the scratchpad is
session-specific.

## 1. Export

```
node scripts/export-batch.mjs --need domain --size 120 --out docs/data/enrich/domain
```

It skips rows answered in any earlier `out-*.json` in that directory and
prints how many rows still need the enrichment.

## 2. Research with subagents

Split the batch into three chunks of 40 and launch three agents in parallel
(model: sonnet), each with this prompt, filling in the chunk range and the
output path:

> Read `<batch file>`. Handle entries N to M only. For EACH entry run ONE
> WebSearch: the company name in quotes plus its first investor, e.g.
> `"Sorair" Haatch`. At most one follow-up search if the first is useless.
> Decide the official website domain: the company's own site only (never
> LinkedIn, Crunchbase, a news article, a job board, an investor page);
> the title or snippet must contain the company name. Return the bare
> registrable domain, lowercase, no www. confidence: "high" when the
> official site was found and named; "medium" when a third-party page
> states the domain or the name match is partial; "low" with domain null
> when ambiguous or nothing found. If the company was acquired, give the
> acquirer's domain and start evidence with "Exited:"; if renamed, give the
> new domain and start evidence with "Rebranded:". If the WebSearch budget
> runs out, STOP: write the remaining entries as domain null, confidence
> "low", evidence "not searched (budget exhausted)". Never answer from
> memory. Write `<out path>` as a JSON array, one object per input entry,
> same order: {"id","company","domain","confidence","evidence"}. Every input
> id exactly once. Reply with the counts only.

Write chunk outputs as `out-<batch>-<chunk>.json` in the same directory.
Wait for all three; if one reports budget exhaustion, do not launch more.

## 3. Apply

```
node scripts/apply-domains.mjs --dry-run docs/data/enrich/domain
```

Check the tally, then run without `--dry-run`. It writes Domain only for
high or medium results whose site answers, never overwrites, and leaves a
dated Notes line on dead or unresolved rows. Entries marked "not searched"
are left untouched and come back in the next export. For "Exited:" or
"Rebranded:" evidence, set Stage to Exited by hand for the exited ones and
say so in the summary; the domain is still written.

## 4. Follow-on chain

New domains unlock the rest. Run, in order:

```
node scripts/coverage.mjs
node scripts/ats-detect.mjs --all
node scripts/hq-from-feeds.mjs
```

Then tick Poll on rows with a supported ATS, a slug and a UK status (the
one-off in `scripts/dedupe-universe.mjs` shows the field ids).

## 5. Report

Rows exported, searched, written, dead, unresolved, not searched; how many
still need the enrichment; and remind Tim to start a new session for the next
batch. Update the Tasks table row for the enrichment if there is one.
