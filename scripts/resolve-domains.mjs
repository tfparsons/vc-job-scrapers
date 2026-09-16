#!/usr/bin/env node
// Domain resolution by Google search through SerpApi (Session C, step 3).
//
// For each Startup Universe row with no Domain, search `"<company>" <first
// investor> startup`, walk the organic results in order, skip directories
// and social sites, and accept the first result whose title or domain label
// contains the normalised company name. Output has the same shape as the
// web-search batches, so scripts/apply-domains.mjs applies it.
//
// Usage:
//   node scripts/resolve-domains.mjs --limit 10 [--skip <out-dir>]   # pilot first, then scale
//     --limit  how many SerpApi searches to spend (free tier: 250 a month)
//     --skip   directory of earlier out-*.json files; rows already resolved
//              there with a live-search domain are not searched again
//
// SERPAPI_KEY comes from the environment or .env.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, listAll, EMPLOYERS_BASE, UNIVERSE, UF as F } from "./lib/airtable.mjs";

loadEnv();
const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 50;
const SKIP_DIR = args.includes("--skip") ? args[args.indexOf("--skip") + 1] : null;
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "out-serpapi.json";
const KEY = process.env.SERPAPI_KEY;
if (!KEY) { console.error("SERPAPI_KEY is not set (environment or .env)"); process.exit(1); }

const THIRD_PARTY = /(^|\.)(linkedin|crunchbase|companieshouse|find-and-update\.company-information\.service|gov|wikipedia|facebook|twitter|x|instagram|youtube|apple|google|glassdoor|indeed|pitchbook|dealroom|beauhurst|tracxn|cbinsights|techcrunch|sifted|eu-startups|uktech|businesscloud|startups|f6s|angel|wellfound|producthunt|github|medium|substack|trustpilot|bloomberg|reuters|ft|theguardian|telegraph|forbes|fundrazr|seedrs|crowdcube|zoominfo|rocketreach|apollo|clay|owler|craft|growjo|endole|opencorporates|duedil|thegazette|prnewswire|businesswire|globenewswire|amazon|shopify|notion|airtable|typeform)\.(com|co|io|org|uk|co\.uk|net|site|so)$/i;

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const hostOf = (u) => { try { return new URL(u).host.toLowerCase().replace(/^www\./, ""); } catch { return null; } };
const registrable = (host) => {
  if (!host) return null;
  const parts = host.split(".");
  const twoLevel = /^(co|org|ac|gov|net|ltd|plc|me)\.uk$|^com\.(au|br)$/;
  if (parts.length > 2 && twoLevel.test(parts.slice(-2).join("."))) return parts.slice(-3).join(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
};

// Titles that mark a page as being ABOUT the company rather than BY it.
const ABOUT_TITLE = /\b(raises|raised|funding|round|series [a-d]|portfolio|acquire[sd]?|acquisition|launches|announce|news|review|profile|crunchbase|linkedin|jobs? at|careers at|investors?)\b/i;

// Prefer a result whose domain label is the company name, anywhere in the
// top ten; a title match alone is weak (news articles and portfolio pages
// name the company in the title) and only counts when the title does not
// read like coverage of the company. First live run, 16 Sep 2026: title-only
// matches were mostly third-party pages, so they are now medium at best and
// apply-domains treats them with suspicion.
function pick(company, results) {
  const key = norm(company);
  if (key.length < 3) return null;
  const usable = (results || []).filter((r) => { const h = hostOf(r.link); return h && !THIRD_PARTY.test(h); });
  for (const r of usable) {
    const host = hostOf(r.link);
    const dom = registrable(host);
    const label = norm(dom.split(".")[0]);
    const inLabel = label === key || (key.length >= 5 && label.includes(key)) || (label.length >= 5 && key.includes(label));
    if (inLabel) return { domain: dom, confidence: "high", evidence: `Google result "${(r.title || "").slice(0, 80)}" at ${host} (name in domain)` };
  }
  for (const r of usable) {
    const host = hostOf(r.link);
    const title = String(r.title || "");
    if (norm(title).includes(key) && !ABOUT_TITLE.test(title)) {
      return { domain: registrable(host), confidence: "medium", evidence: `Google result "${title.slice(0, 80)}" at ${host} (name in title only)` };
    }
  }
  return null;
}

async function search(q) {
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google");
  u.searchParams.set("q", q);
  u.searchParams.set("gl", "uk");
  u.searchParams.set("hl", "en");
  u.searchParams.set("num", "10");
  u.searchParams.set("api_key", KEY);
  const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json.organic_results || [];
}

const already = new Set();
if (SKIP_DIR) {
  for (const f of readdirSync(SKIP_DIR).filter((n) => /^out-.*\.json$/.test(n))) {
    for (const r of JSON.parse(readFileSync(join(SKIP_DIR, f), "utf8"))) {
      const fromMemory = /prior knowledge|general knowledge|from memory|not searched|budget exhausted|unverified live/i.test(r.evidence || "");
      if (r.domain && !fromMemory && r.confidence !== "low") already.add(r.id);
    }
  }
}

const rows = (await listAll(EMPLOYERS_BASE, UNIVERSE, { returnFieldsByFieldId: "true" })).filter((r) => !r.fields[F.domain] && !already.has(r.id));
console.log(`${rows.length} rows without a domain (after skipping ${already.size} already resolved); spending up to ${LIMIT} searches`);

// Every raw response is kept next to the output so results can be re-scored
// offline after a picker change, without spending the quota again.
const RAW = OUT.replace(/\.json$/, "") + "-raw.json";
const raw = [];
const out = [];
let spent = 0;
for (const row of rows) {
  if (spent >= LIMIT) break;
  const company = row.fields[F.company];
  const investor = String(row.fields[F.investors] || "").split(",")[0].trim();
  const q = `"${company}" ${investor || "startup UK"}${investor ? " startup" : ""}`;
  let results;
  try { results = await search(q); spent += 1; } catch (err) { console.error(`  ${company}: ${err.message}`); if (/run out|limit|exceeded|throttled/i.test(err.message)) break; continue; }
  raw.push({ id: row.id, company, q, results: results.map((r) => ({ title: r.title, link: r.link, snippet: r.snippet })) });
  writeFileSync(RAW, JSON.stringify(raw, null, 1));
  const p = pick(company, results);
  out.push({ id: row.id, company, domain: p ? p.domain : null, confidence: p ? p.confidence : "low", evidence: p ? p.evidence : `no Google result matched the name (top: ${(results[0] && hostOf(results[0].link)) || "none"})` });
  console.log(`  ${company.padEnd(28)} ${p ? p.domain.padEnd(28) + p.confidence : "-"}`);
}
writeFileSync(OUT, JSON.stringify(out, null, 2));
const c = out.reduce((a, r) => ({ ...a, [r.confidence]: (a[r.confidence] || 0) + 1 }), {});
console.log(`\n${spent} searches spent; results:`, c, `-> ${OUT}`);
