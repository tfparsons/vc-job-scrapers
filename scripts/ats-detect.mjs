#!/usr/bin/env node
// ATS detection for Startup Universe (Session C, step 4).
//
// For every row with a Domain and no ATS yet (London / UK rows first), fetch
// the homepage and the usual careers paths, follow any nav link that looks
// like a careers page, and look for ATS host signatures in hrefs, iframes,
// scripts and redirects. When the ATS has a public feed the slug is verified
// by calling it, so Session D can trust `Poll` rows. Writes ATS, ATS slug,
// Careers URL, Last verified, and a Notes line when nothing was found.
//
// Usage:
//   node scripts/ats-detect.mjs                 # London / UK rows, write
//   node scripts/ats-detect.mjs --all           # every row with a domain
//   node scripts/ats-detect.mjs --dry-run       # report only
//   node scripts/ats-detect.mjs --limit 20      # first N rows (for a look)
//   node scripts/ats-detect.mjs --recheck       # include rows already checked
//   node scripts/ats-detect.mjs --ids recA,recB # just these rows
//
// Polite: 4 domains at a time, 12 s per request, a descriptive User-Agent,
// at most six requests per domain.

import { writeFileSync } from "node:fs";
import { loadEnv, listAll, patchAll, EMPLOYERS_BASE, UNIVERSE, UF as F } from "./lib/airtable.mjs";

loadEnv();

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ALL = args.includes("--all");
const RECHECK = args.includes("--recheck");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
// --ids rec1,rec2: only these rows, whatever their UK status or ATS (implies --recheck).
const IDS = args.includes("--ids") ? new Set(args[args.indexOf("--ids") + 1].split(",").map((s) => s.trim()).filter(Boolean)) : null;
const UA = "VC-Job-Scrapers/2.1 (personal job search tool; github.com/tfparsons/vc-job-scrapers)";
const CONCURRENCY = 4;
const TIMEOUT_MS = 12000;
const CAREERS_PATHS = ["/careers", "/jobs", "/join-us", "/join", "/work-with-us", "/careers/", "/company/careers"];
const NAV_WORDS = /career|jobs|join|hiring|open roles|open positions|vacanc|work with us|we're hiring|we are hiring/i;
const UK_STATUSES = new Set(["London HQ", "London office", "UK (non-London)"]);

// Signature regexes run over page HTML and final URLs. `slug` is what the
// public feed needs; `feed` builds the verification URL (null = no feed).
const ATS = [
  { name: "Ashby", re: /(?:jobs\.ashbyhq\.com\/|api\.ashbyhq\.com\/posting-api\/job-board\/)([a-z0-9][a-z0-9._-]*)/i, feed: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`, jobs: (j) => j.jobs, skip: /^(api|embed|posting-api)$/ },
  { name: "Greenhouse", re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?(?:[^"'\s]*&)?for=)?([a-z0-9][a-z0-9_-]*)/i, feed: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, jobs: (j) => j.jobs, skip: /^embed$/ },
  { name: "Greenhouse", re: /boards-api(?:\.eu)?\.greenhouse\.io\/v1\/boards\/([a-z0-9][a-z0-9_-]*)/i, feed: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, jobs: (j) => j.jobs },
  { name: "Lever", re: /(?:jobs|api)(?:\.eu)?\.lever\.co\/(?:v0\/postings\/)?([a-z0-9][a-z0-9._-]*)/i, feed: (s) => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`, jobs: (j) => (Array.isArray(j) ? j : null) },
  { name: "Workable", re: /apply\.workable\.com\/(?:api\/v1\/widget\/accounts\/)?([a-z0-9][a-z0-9_-]*)/i, feed: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}`, jobs: (j) => j.jobs },
  { name: "Workable", re: /([a-z0-9][a-z0-9_-]*)\.workable\.com/i, feed: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}`, jobs: (j) => j.jobs, skip: /^(www|apply|help|resources|jobs|careers)$/ },
  { name: "Teamtailor", re: /https?:\/\/([a-z0-9][a-z0-9.-]*\.teamtailor\.com)/i, feed: (s) => `https://${s}/jobs.rss`, jobs: (t) => (typeof t === "string" && /<rss|<feed/i.test(t) ? [] : null), text: true, skip: /^(www|cdn|static|assets)\./ },
  // Teamtailor on a custom host (career.spendesk.com): the page pulls its
  // assets from teamtailor-cdn.com, and the slug is the host itself.
  { name: "Teamtailor", re: /teamtailor-cdn\.com/i, hostIsSlug: true, feed: (s) => `https://${s}/jobs.rss`, jobs: (t) => (typeof t === "string" && /<rss|<feed/i.test(t) ? [] : null), text: true },
  { name: "Recruitee", re: /([a-z0-9][a-z0-9-]*)\.recruitee\.com/i, feed: (s) => `https://${s}.recruitee.com/api/offers/`, jobs: (j) => j.offers, skip: /^(www|docs|api|help)$/ },
  { name: "Recruitee", re: /RTWidget\(\{\s*["']companies["']\s*:\s*\[\s*["']([a-z0-9][a-z0-9-]*)["']/i, feed: (s) => `https://${s}.recruitee.com/api/offers/`, jobs: (j) => j.offers },
  { name: "SmartRecruiters", re: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9][A-Za-z0-9_-]*)/, feed: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`, jobs: (j) => j.content },
  { name: "Personio", re: /([a-z0-9][a-z0-9-]*)\.jobs\.personio\.(?:de|com)/i, feed: (s) => `https://${s}.jobs.personio.de/xml?language=en`, jobs: (t) => (typeof t === "string" && /<workzag-jobs|<position/i.test(t) ? [] : null), text: true },
  { name: "Pinpoint", re: /([a-z0-9][a-z0-9-]*)\.pinpointhq\.com/i, feed: (s) => `https://${s}.pinpointhq.com/postings.json`, jobs: (j) => j.data || j.postings || (Array.isArray(j) ? j : null), skip: /^(www|app|help)$/ },
  { name: "BambooHR", re: /([a-z0-9][a-z0-9-]*)\.bamboohr\.com/i, feed: (s) => `https://${s}.bamboohr.com/careers/list`, jobs: (j) => j.result, skip: /^(www|help|resources)$/ },
  { name: "Workday", re: /([a-z0-9][a-z0-9-]*\.(?:wd\d+\.)?myworkdayjobs\.com\/[a-z0-9_-]+)/i, feed: null },
  { name: "Other / custom", re: /(jobs\.jobvite\.com\/[a-z0-9-]+|[a-z0-9-]+\.hibob\.com|[a-z0-9-]+\.homerun\.co|[a-z0-9-]+\.polymer\.co|wellfound\.com\/company\/[a-z0-9-]+|jobs\.gem\.com\/[a-z0-9-]+|[a-z0-9-]+\.rippling-ats\.com|ats\.rippling\.com\/[a-z0-9-]+|[a-z0-9-]+\.applytojob\.com|[a-z0-9-]+\.breezy\.hr|[a-z0-9-]+\.freshteam\.com|[a-z0-9-]+\.zohorecruit\.com)/i, feed: null },
];

// Pages that name the vendor without a usable slug (an embed div, a job id
// parameter, an API base URL with the slug added in JavaScript). The slug is
// then guessed from the domain and company name and verified via the feed.
const BRAND_HINTS = [
  { name: "Ashby", re: /ashby_embed|ashby_jid|ashbyhq\.com/i },
  { name: "Greenhouse", re: /greenhouse\.io|grnhse/i },
  { name: "Lever", re: /lever\.co\b|lever-jobs/i },
  { name: "Workable", re: /workable\.com/i },
  { name: "Recruitee", re: /recruitee/i },
  { name: "Teamtailor", re: /teamtailor/i },
];

export function findBrand(html) {
  for (const b of BRAND_HINTS) if (b.re.test(html)) return b.name;
  return null;
}

export function slugGuesses(domain, company) {
  const label = domain.split(".")[0];
  const flat = String(company || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const dashed = String(company || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [...new Set([label, flat, dashed].filter((s) => s && s.length >= 2))];
}

async function get(url, { text = true, redirect = "follow" } = {}) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: text ? "text/html,*/*" : "application/json,*/*" }, redirect, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.text();
  return { ok: res.ok, status: res.status, url: res.url, body };
}

const hostOf = (url) => { try { return new URL(url).host.toLowerCase(); } catch { return null; } };
const normDomain = (s) => String(s || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];

// Look for any ATS signature in a page body and its final URL. Returns the
// first hit in ATS order (the ones with feeds come first).
export function findAts(html, finalUrl = "") {
  const hay = `${finalUrl}\n${html}`;
  for (const a of ATS) {
    const m = hay.match(a.re);
    if (!m) continue;
    const slug = a.hostIsSlug ? hostOf(finalUrl) : m[1];
    if (!slug || (a.skip && a.skip.test(slug))) continue;
    return { name: a.name, slug, ats: a, evidence: m[0] };
  }
  return null;
}

// Links in the page whose text or href looks like a careers page.
export function careersLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ");
    if (!NAV_WORDS.test(text) && !NAV_WORDS.test(href)) continue;
    try { out.push(new URL(href, base).toString()); } catch { /* ignore */ }
  }
  return [...new Set(out)].slice(0, 3);
}

// First same-site link that looks like an individual job page.
export function firstJobLink(html, base) {
  const origin = new URL(base).origin;
  for (const m of html.matchAll(/href=["']([^"'#?]+)["']/gi)) {
    if (!/\/(?:jobs?|careers?|positions?|openings?|roles?|vacancies)\/[a-z0-9][a-z0-9-]{5,}\/?$/i.test(m[1])) continue;
    try {
      const u = new URL(m[1], base);
      if (u.origin === origin) return u.toString();
    } catch { /* ignore */ }
  }
  return null;
}

async function verify(hit) {
  if (!hit.ats.feed) return { verified: null, count: null };
  try {
    const r = await get(hit.ats.feed(hit.slug), { text: !!hit.ats.text });
    if (!r.ok) return { verified: false, count: null, why: `feed HTTP ${r.status}` };
    let parsed = r.body;
    if (!hit.ats.text) { try { parsed = JSON.parse(r.body); } catch { return { verified: false, count: null, why: "feed not JSON" }; } }
    const jobs = hit.ats.jobs(parsed);
    if (jobs == null) return { verified: false, count: null, why: "feed shape unexpected" };
    // Feeds that are XML/RSS return [] from `jobs` as a "present" marker, not a count.
    return { verified: true, count: Array.isArray(jobs) && !hit.ats.text ? jobs.length : null };
  } catch (err) {
    return { verified: false, count: null, why: err.name === "TimeoutError" ? "feed timeout" : err.message };
  }
}

export async function detect(domain) {
  const tried = [];
  let careersUrl = null;
  let homeHtml = "";
  let brand = null;
  const pages = [`https://${domain}/`];
  for (const p of CAREERS_PATHS) pages.push(`https://${domain}${p}`);
  pages.push(`https://careers.${domain}/`, `https://jobs.${domain}/`);

  for (let i = 0; i < pages.length && tried.length < 6; i++) {
    const url = pages[i];
    let r;
    try {
      r = await get(url);
    } catch (err) {
      tried.push(`${url} (${err.name === "TimeoutError" ? "timeout" : "unreachable"})`);
      // Some hosts only answer on www. Retry the homepage once that way.
      if (i === 0 && !url.includes("://www.")) { pages[0] = `https://www.${domain}/`; i -= 1; continue; }
      if (i === 0) break;
      continue;
    }
    tried.push(`${url} (${r.status})`);
    if (!r.ok) continue;
    if (i === 0) {
      homeHtml = r.body;
      // Follow the site's own careers link first, before guessing paths.
      for (const link of careersLinks(r.body, r.url)) {
        if (!pages.includes(link)) pages.splice(1, 0, link);
      }
    }
    const hit = findAts(r.body, r.url);
    if (hit) return { hit, careersUrl: i === 0 ? null : r.url, tried };
    if (!brand) { const b = findBrand(r.body); if (b) brand = { name: b, url: r.url }; }
    if (i > 0 && !careersUrl && /career|job|join|hiring|position|vacanc/i.test(r.body.slice(0, 20000))) {
      careersUrl = r.url;
      // A careers page that lists roles at its own URLs: the apply button on
      // one of them usually points at the ATS, so look at the first one.
      const job = firstJobLink(r.body, r.url);
      if (job && !pages.includes(job)) pages.splice(i + 1, 0, job);
    }
  }
  return { hit: null, brand, careersUrl, tried, homeReached: !!homeHtml };
}

// A vendor was named but no slug: try the likely slugs against the feed.
async function resolveBrand(brand, domain, company) {
  const ats = ATS.find((a) => a.name === brand.name && a.feed && !a.hostIsSlug);
  if (!ats) return null;
  for (const slug of slugGuesses(domain, company)) {
    const hit = { name: ats.name, slug, ats, evidence: `${brand.name} hint on ${brand.url}` };
    const v = await verify(hit);
    if (v.verified) return { hit, v };
  }
  return null;
}

async function mapPool(items, fn, limit) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function main() {
  const rows = await listAll(EMPLOYERS_BASE, UNIVERSE, { returnFieldsByFieldId: "true" });
  const todo = rows.filter((r) => {
    if (!r.fields[F.domain]) return false;
    if (IDS) return IDS.has(r.id);
    if (!ALL && !UK_STATUSES.has(r.fields[F.londonStatus])) return false;
    const ats = r.fields[F.ats];
    return RECHECK || !ats || ats === "Not checked";
  }).slice(0, LIMIT);
  console.log(`${todo.length} rows to check (${ALL ? "all with a domain" : "London / UK"}${RECHECK ? ", including checked" : ""})`);

  const today = new Date().toISOString().slice(0, 10);
  const updates = [];
  const tally = {};
  const report = [];
  let done = 0;
  await mapPool(todo, async (row) => {
    const domain = normDomain(row.fields[F.domain]);
    const res = await detect(domain);
    const fields = { [F.lastVerified]: today };
    let line;
    let guessed = null;
    if (!res.hit && res.brand) {
      guessed = await resolveBrand(res.brand, domain, row.fields[F.company]);
      if (guessed) { res.hit = guessed.hit; res.careersUrl = res.careersUrl || res.brand.url; }
    }
    if (res.hit) {
      const v = guessed ? guessed.v : await verify(res.hit);
      const name = v.verified === false ? "Other / custom" : res.hit.name;
      fields[F.ats] = name;
      fields[F.atsSlug] = res.hit.slug;
      if (res.careersUrl && !row.fields[F.careersUrl]) fields[F.careersUrl] = res.careersUrl;
      const note = v.verified === false ? `ATS ${res.hit.name} seen (${res.hit.evidence}) but feed failed: ${v.why}` : null;
      if (note) fields[F.notes] = [row.fields[F.notes], `${today}: ${note}`].filter(Boolean).join("\n");
      line = `${name}${v.verified ? ` (${v.count ?? "?"} jobs)` : v.verified === false ? " (unverified)" : ""}`;
    } else {
      // A vendor hint with no verifiable slug still records the vendor, so
      // Session D can pick it up once the slug is found by hand.
      fields[F.ats] = res.brand ? res.brand.name : "None found";
      if (res.careersUrl && !row.fields[F.careersUrl]) fields[F.careersUrl] = res.careersUrl;
      const why = res.brand ? `${res.brand.name} named on ${res.brand.url} but no slug verified`
        : res.homeReached === false ? "site unreachable" : `no ATS signature on ${res.tried.length} pages`;
      fields[F.notes] = [row.fields[F.notes], `${today}: ATS check: ${why}`].filter(Boolean).join("\n");
      line = `None found (${why})`;
    }
    tally[fields[F.ats]] = (tally[fields[F.ats]] || 0) + 1;
    updates.push({ id: row.id, fields });
    report.push({ company: row.fields[F.company], domain, result: line, slug: fields[F.atsSlug] || null, careers: fields[F.careersUrl] || row.fields[F.careersUrl] || null, tried: res.tried });
    done += 1;
    if (done % 25 === 0) console.log(`  ${done}/${todo.length}`);
  }, CONCURRENCY);

  console.log("\nResults:", tally);
  writeFileSync("ats-report.json", JSON.stringify(report, null, 2));
  console.log("Details written to ats-report.json");
  if (DRY) return;
  await patchAll(EMPLOYERS_BASE, UNIVERSE, updates, (n, t) => { if (n % 100 === 0 || n === t) console.log(`  wrote ${n}/${t}`); });
  console.log("Done.");
}

main().catch((err) => { console.error(err.message); process.exit(1); });
