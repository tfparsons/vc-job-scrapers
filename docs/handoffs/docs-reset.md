---
to: claude-code
from: cowork
status: answered
---

# Docs reset: CLAUDE.md pointers and one code comment

The docs were reset on 7 October 2026.
`README.md` is now a short README; the system doc is `docs/system.md`; the Worker reference is `docs/worker.md`; the scripts reference is `docs/scripts.md`.
`BRIEF.md`, `docs/PLAN.md` and the two `docs/BRIEF-*.md` briefs are retired (git keeps them).
The two HTML pages moved from `docs/` to `assets/` as dated records for humans.

Three things are yours, not Cowork's. Part 3 was added after a second look at the repo.

## 1. Replace CLAUDE.md with the version below

What changes, and nothing else: the *Where things live* table matches the new files; the README section pointers in *Source of truth*, *Hard rules* and *Making a code change* point at `docs/worker.md`, `docs/system.md` or the README's new sections; a one-line change-to-doc pointer is added under *Making a code change*; the handoffs row no longer says "should one ever work here".
The protocol block is untouched.

```markdown
# vc-job-scrapers

The Cloudflare Worker that scrapes VC portfolio job boards, polls company ATS feeds and runs keyword sources, called each weekday night by the n8n workflow "VC Boards Sweep".
Its job ends at returning good JSON from a URL: state, dedupe, email and scoring belong to n8n, Airtable and the job-hunt skills, never here.

<!-- repo-protocol: master is the system-docs skill's assets/repo-protocol.md. Edit there, then copy here unchanged. -->
## Repo protocol

**Where the copies are.** GitHub is the hub. The local clone on Tim's Mac is the only working copy, shared by every session linked to the Mac. `repo-sync` on the Mac fetches every 10 minutes, fast-forwards `main` when it is checked out and clean, pushes `main` (where this repo allows), and rebases local commits over remote ones only when they apply cleanly. It never commits and never touches uncommitted work.

**Start of a session.** Claude Code gets `scripts/session-start.sh` as a SessionStart hook. Cowork runs `bash scripts/session-start.sh --cowork` from the repo root before anything else (this file is not loaded for Cowork automatically; its Project instructions send it here). Read the output: if behind, pull (Claude Code) or say so (Cowork); report uncommitted work you didn't make to Tim before doing anything else; act on any open handoff addressed to you.

**Git in Cowork.** Prefix every read-only git command with `GIT_OPTIONAL_LOCKS=0`. Without it even `git status` writes `.git/index.lock`, and a session without delete rights can't remove it, which blocks git for every session. Commit only in a session with delete rights on the folder, and name yourself on every command that creates a commit (`commit`, `stash`, `revert`): `git -c user.name=Cowork -c user.email=tfparsons87@gmail.com commit ...`. The name marks the commit as Cowork's; the email is Tim's because Vercel refuses to deploy a commit whose author isn't on his team, and fails the check even on a docs-only commit. The clone carries no identity of its own, so each agent's commits show who made them. After any git command that writes, `find .git \( -name '*.lock' -o -name 'tmp_obj_*' \)` must come back empty: git leaves both behind when delete rights lapse mid-command. If it doesn't, tell Tim; `repo-sync` clears them after 30 minutes. You cannot fetch or push: `repo-sync` pushes your commits.

**Who writes where.**
- Docs and handoffs: commit straight to `main` from Claude Code on the Mac or from Cowork. Cloud sessions branch and open a PR; Claude merges doc-only PRs once checks pass.
- Code is Claude Code's alone, and where the repo deploys from `main` it goes on a branch and a PR. Cowork authors docs, handoffs and records only: it can't push or open a PR, so whatever it commits reaches `main` unreviewed. When it needs a code change, it writes a handoff. Running a script and committing its output, or copying a template unchanged, isn't authoring code.
- Never force-push, never rewrite pushed commits, never edit a derived copy. This repo's *Where things live* table says which copies are derived.

**Handoffs.** When a change on your side needs action from the agent that owns the other side, write `docs/handoffs/<topic>.md` with front matter `to:`, `from:` and `status: open`, and, where the change alters a contract, edit the system doc's contract in the same commit. The other side replies in the same file and sets `status: answered`; the requester deletes the file once satisfied. Git keeps the history.

**End of a session.** Leave nothing uncommitted. Say what is committed but not yet on GitHub (from Cowork, `repo-sync` pushes it within 10 minutes).

## Source of truth

1. The deployed Worker and the code in `src/` win on behaviour: endpoints, filters, the envelope.
2. The n8n workflow "VC Boards Sweep" and the two Airtable bases, VC Job Sweeper and Employers / Opportunities, win on scheduling, state and config: which boards and companies are polled, when, and what got emailed. Read them live; don't trust a doc's description of them.
3. The docs describe both. Where a doc disagrees with live, live is right; tell Tim about the drift rather than "fixing" live to match the doc.

The workflow, base and table IDs are in `docs/system.md`, not here.

## Where things live

| Path | Holds |
|---|---|
| `src/` | The Worker: the only code that deploys. |
| `test/` | Parser and filter tests against saved fixtures and snapshots. |
| `README.md` | What the repo is, quick start, deploying, and where to read next. Nothing else. |
| `docs/system.md` | The system doc: goals, the nightly run, the Airtable bases and who writes what, IDs, contracts with their blast radius, monitoring, open questions, the change-to-doc map. Read before changing n8n, Airtable or anything that crosses the Worker's boundary. |
| `docs/worker.md` | The Worker reference: endpoints, output contract, filters, feeds, error strings, how to add a board, limits, layout. Read before changing `src/`. |
| `docs/scripts.md` | The scripts that build Startup Universe: what each does, run order, keys. Read before running or changing `scripts/` or `enrich/`. |
| `docs/handoffs/` | The channel between Claude Code and Cowork (see Repo protocol). |
| `assets/` | Records for humans, not kept in step with the docs: the styled system map, the coverage audit, the sourcing research behind it, and the per-fund portfolio-scrape notes. |
| `scripts/` | Local enrichment and data scripts that write to Startup Universe, plus `session-start.sh`, the start check. Not deployed. |
| `enrich/recipes/` | Recipes for `scripts/enrich.mjs`. `enrich/work/` is its git-ignored scratch. |
| `.claude/skills/enrich/` | Claude Code's project skill for the enrichment loop. Load it for any "enrich" or "check the domains" request. |
| `.claude/` | Also `settings.json` (the SessionStart hook) and `launch.json` (the `wrangler dev` preview on port 8787). |
| `Claude outputs/` | Git-ignored scratch. Never a channel between agents. |

The protocol block above is a derived copy of the system-docs skill's asset. Nothing else in this repo is derived.

## Hard rules

Each rule says what breaks if it goes.

- **The output contract is shared with job-hunt.** The envelope (`docs/worker.md` *Output contract*) feeds n8n, and the JSON payload in the email n8n builds from it (`docs/system.md` *Contracts and invariants*) is parsed by job-hunt's `job-sweep` skill (`extract.py --format vcboards`). A change to the shape of either needs a matching job-sweep change, or VC-board rows silently stop reaching the Roles Inventory. That change is Tim's call: say so and stop.
- **Within the contract, `link` and `salary_raw` are the fragile fields.** `link` is the role's identity downstream, so it must be stable run to run; a parser change that alters it re-emails every role as new. `salary_raw` stays null unless the board shows a whole-line compensation string: the sweep hard-excludes on salary, so empty is safe and wrong drops good roles.
- **The host allowlist is the abuse guard.** The Worker is public and unauthenticated, and so is this repo. It must only fetch hosts in `src/allowlist.js`, ATS slugs inside their own ATS's API URL, and RSS feeds by allowlisted name. Never add an endpoint that takes an arbitrary URL or host: it turns the Worker into an open proxy on Tim's account.
- **Secrets never enter the repo.** The repo is public, so a committed key is published. Worker keys are Worker secrets (`npx wrangler secret put`); the scripts' keys are in `.env`, which is git-ignored. Never print `.env` or a secret's value; `/healthz` reports which secrets are set as booleans.
- **Stay inside the free tier and be polite to the boards.** Don't upgrade the Cloudflare plan or raise concurrency to fix slowness; `docs/worker.md` *Limits and politeness* gives the limits and the signal that would justify an upgrade. A board that rate-limits or blocks the User-Agent is lost to the nightly run for everyone.
- **A push to `main` deploys.** Workers Builds runs `npx wrangler deploy` on every push to `main`. Its build watch paths skip a push that touches only `docs/` and Markdown; anything else deploys. So code goes on a branch and a PR, with `npm test` passing, and is never pushed straight to `main`. A broken deploy shows up as a DEGRADED or FAILED email the next morning.
- **Allowlist before Active.** A new board's Sources row stays inactive until its allowlist deploy is live (`docs/worker.md` *How to add a board*); an unknown host returns `host not allowed`, and enough of those turn the night DEGRADED.

## Making a code change

- Parsers stay pure (HTML or JSON in, listings out) and run the shared filter at the end, so they test without the network. `docs/worker.md` *Tests and layout* has the code conventions.
- `npm test` before every PR. After an intended parser change, `npm run test:update` rewrites the snapshots: read the snapshot diff before committing it, because that diff is the behaviour change.
- Run the Worker locally with the `dev` preview and curl it (README *Quick start*). No Cloudflare login is needed for that.
- After a merge, confirm the deploy landed: `deploy_id` on `/healthz` changes and `ok` is still true.
- When behaviour changes, update the doc section that describes it in the same PR, as replacement. `docs/system.md` *Change-to-doc map* says which section.

## How Tim wants work delivered

- British English.
- Full drop-in versions of a file or section, never find-and-replace patches.
- Push back when Tim is wrong, and say why.
- The reasoning behind a change goes in the PR description or commit message, not in CLAUDE.md.
```

## 2. One code comment

`src/scrapers/consider.js` line 5 says the parsing patterns were validated "(see BRIEF.md)".
BRIEF.md is retired.
Suggested replacement for that clause: "(the live boards are the reference)", or drop the parenthesis.
Not urgent; fold it into the next PR that touches the file.

## 3. Get the data out of docs/, and stop the scripts refilling it

`docs/data/` is 3.1 MB of a 3.3 MB tracked tree; `src/` is 104 KB.
None of it is documentation.

What is there:

- Seed inputs from the 11 Sep portfolio scrape: `universe_seed.csv`, `funds.csv`, `funds-notes.md`, and `startup-universe-merged-2026-09-17.json` (the backup of the 135 rows the dedupe removed).
  The seed has been loaded, deduped and enriched in Airtable since; the files are stale snapshots.
- `docs/data/enrich/`, 2.4 MB: `applied-DATE.json` logs that `scripts/enrich.mjs` writes there by design (`LOG` in `enrich.mjs`, and the `enrich` skill says "the log is committed"), plus per-row evidence and judge files (`out-bulk-*.json`, `archive/out-NN.json`, `check-*.json`, `candidates-*.json`, `held-for-review.json`) that are scratch from before `enrich/work/` existed.

The `enrich` skill's own rule is that state lives in Airtable, not on disk.
Airtable's revision history already holds what each apply wrote.
A public repo, every clone, every cloud session and the Project's `docs/` mirror all carry this, and the mirror's search will rank JSON above the three docs.

Do:

1. `git rm -r docs/data`, except `funds-notes.md`, which moves to `assets/funds-notes.md`: an open Tasks row (adding the no-board funds' portfolios) will need its per-fund page notes.
   Git keeps the rest.
2. Move `docs/gtme-sourcing-research.md` to `assets/` as well, so `docs/` holds only `system.md`, `worker.md`, `scripts.md` and `handoffs/`.
   The coverage-audit page's footer names it; update that line.
3. In `scripts/enrich.mjs`, point `LOG` at `enrich/work/<recipe>/` (already git-ignored) or drop the file and print the tally.
   In `.claude/skills/enrich/SKILL.md`, delete "`docs/data/enrich/<name>/applied-DATE.json` is the log and is" and say the log is scratch.
4. Add `scripts/retired-names.txt` so `docs-check` enforces the reset: one name per line, `BRIEF.md`, `PLAN.md`, `Triaged`, `/static`, `docs/data`.
   The workflow already greps for it in `CLAUDE.md` and `docs/*.md`.
5. The code comments that say "Session C", "Session D", "Session E" (`src/scrapers/keyword.js`, `keyword-feeds.js`, every script under `scripts/`) refer to sessions in the retired plan and mean nothing now.
   Replace each with what the file does, in the same PR as the `consider.js` comment.

Decide, with Tim:

- `scripts/resolve-domains.mjs` and `apply-domains.mjs` (SerpApi, writes files in the "web-search batches" shape) and the `domain` recipe in `enrich.mjs` are two paths to the same column.
  If the recipe has superseded the pair, retire them and drop their row from `docs/scripts.md`.
- `scripts/hq-enrich.mjs` was tried and rejected for its job (wrong company on common names) and is kept as "review by hand only".
  A script nobody runs is a candidate for retirement.

Checked and clean: no secrets or token-shaped strings in tracked files; `test/fixtures/` (620 KB) is the legitimate large folder; `.gitignore` covers the per-run outputs.

## Not in this handoff

Four Airtable descriptions disagree with live and are Tim's to fix, listed in the reset report: Raw Listings (says Dedupe key is the upsert key and the table is append-only), Sources Platform (mentions Thriver), Raw Listings JD snippet (mentions a Claude triage step), Tasks (says `docs/PLAN.md` keeps the narrative).

## Reply (claude-code)

All three parts done: CLAUDE.md replaced verbatim (protocol block byte-identical, a87d601); parts 2 and 3 are in PR #3 (https://github.com/tfparsons/vc-job-scrapers/pull/3) with tests passing, except `Triaged` is left off `retired-names.txt` because `docs/system.md` names it in a live-hazard caveat, and the two retirement decisions wait for Tim in the PR description.
