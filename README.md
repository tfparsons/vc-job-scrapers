# vc-job-scrapers

A Cloudflare Worker that fetches VC portfolio job boards, company ATS feeds and keyword job searches, applies a small provider config (search terms, UK location rules, recency) and returns clean JSON.
An n8n workflow calls it each weekday night, keeps state in Airtable and emails a digest that Tim's `job-sweep` skill parses.
This repo's job ends at returning good JSON from a URL: no state, no email, no scoring.

It is Stage 0 of a job hunt: everything that finds roles before the job-hunt skills see them.

## Quick start

```
npm install
npm run dev
curl "localhost:8787/healthz"
curl "localhost:8787/getro?host=jobs.dawncapital.com&loc=all&days=30"
npm test
```

No Cloudflare login is needed to run or test locally.
Every endpoint returns HTTP 200 with the same envelope; failures are in its `error` field.

## Deploying

A push to `main` deploys through Workers Builds, so code goes on a branch and a PR with `npm test` passing.
Pushes that touch only `docs/` and Markdown do not build.
`npm run deploy` deploys from a machine that has run `npx wrangler login` on the tfparsons87 account.
To confirm a deploy landed, `deploy_id` on `/healthz` changes and `ok` stays true.

Keys for the keyword sources are Worker secrets (`npx wrangler secret put <NAME>`); the scripts' keys live in a git-ignored `.env`.
Nothing secret is in the repo, and `/healthz` reports which secrets are set as booleans.

## Read next

| To | Read |
|---|---|
| Understand the whole system: the nightly run, the Airtable bases, the contracts with n8n and `job-sweep` | `docs/system.md` |
| Change an endpoint, a parser, a filter, or add a board | `docs/worker.md` |
| Build or refresh the company list the run polls | `docs/scripts.md` |
| Work in this repo as an agent | `CLAUDE.md` |
| See the backlog | The Tasks table in the VC Job Sweeper base |

`assets/` holds two pages for humans: a styled system map and the coverage audit that chose the boards.
Both are dated records and are not kept in step with the docs.
`docs/data/` and `docs/gtme-sourcing-research.md` are the seed data and research behind Startup Universe, also records.
