#!/usr/bin/env node
// Candidate domains for companies with none, with no model and no paid API.
// Per company: guess name-based hosts, ask Clearbit autocomplete, take the top
// DuckDuckGo results; fetch each candidate's homepage title and description;
// score. Output is a compact file a model (or Tim) can judge in one read.
//
//   node scripts/find-domains.mjs --limit 12        (pilot)
//   node scripts/find-domains.mjs                   (all blank-domain rows)
//   node scripts/find-domains.mjs --check           (existing domains: fetch title only)

import { writeFileSync, mkdirSync } from "node:fs";
import { loadEnv, listAll, EMPLOYERS_BASE, UNIVERSE } from "./lib/airtable.mjs";

loadEnv();
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const CHECK = args.includes("--check");
const LIMIT = Number(opt("--limit", 0));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const NOT_COMPANY = /linkedin|crunchbase|pitchbook|tracxn|twitter|x\.com|facebook|instagram|youtube|wikipedia|glassdoor|indeed|techcrunch|sifted|medium\.com|github|apple\.com|google\.|bloomberg|dealroom|cbinsights|zoominfo|rocketreach|owler|f6s|wellfound|angel\.co|ycombinator|producthunt|g2\.com|capterra|gov\.uk|companieshouse|endole|beauhurst|eu-startups|uktech|businesswire|prnewswire|finsmes|tech\.eu|forbes|reuters|ft\.com/i;

const slug = (s) => s.toLowerCase().replace(/&/g, "and").replace(/\(.*?\)/g, "").replace(/\b(ltd|limited|inc|llc|gmbh|the)\b/g, "").replace(/[^a-z0-9]/g, "");
const host = (u) => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, ""); } catch { return null; } };
const clean = (s) => (s || "").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();

async function get(url, ms = 8000) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/json" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    return { status: res.status, url: res.url, text: res.status < 400 ? (await res.text()).slice(0, 200000) : "" };
  } catch (e) { lastErr = e.cause?.code || e.name; return null; }
}
let lastErr = "";

async function page(domain, ms) {
  const r = (await get(`https://${domain}/`, ms)) || (await get(`https://www.${domain}/`, ms));
  if (!r) return null;
  if (!r.text) return { final: domain, title: `(site answers HTTP ${r.status})`, desc: "", site: "" };
  const t = r.text;
  const title = clean(t.match(/<title[^>]*>([^<]*)/i)?.[1]);
  const desc = clean(t.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)/i)?.[1] || t.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)/i)?.[1]);
  const site = clean(t.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)/i)?.[1]);
  return { final: host(r.url), title: title.slice(0, 120), desc: desc.slice(0, 200), site };
}

async function candidates(name, investors) {
  const s = slug(name);
  const out = new Map(); // domain -> sources
  const add = (d, src) => { if (d && !NOT_COMPANY.test(d)) out.set(d, [...(out.get(d) || []), src]); };
  if (s.length >= 3) for (const d of [`${s}.com`, `${s}.io`, `${s}.ai`, `${s}.co`, `${s}.co.uk`, `${s}.app`, `get${s}.com`, `${s}hq.com`, `try${s}.com`, `${s}.tech`, `${s}.health`, `${s}.energy`]) add(d, "guess");
  const cb = await get(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`);
  try { for (const c of JSON.parse(cb.text).slice(0, 3)) if (slug(c.name).includes(s) || s.includes(slug(c.name))) add(c.domain, "clearbit"); } catch { /* none */ }
  const inv = String(investors || "").split(/[,;]/)[0].trim();
  const ddg = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"${name}" ${inv}`.trim())}`);
  if (ddg) for (const m of [...ddg.text.matchAll(/uddg=([^&"]+)/g)].slice(0, 6)) add(host(decodeURIComponent(m[1])), "ddg");
  return out;
}

function score(name, domain, p, sources) {
  const s = slug(name);
  let n = 0;
  if (slug(domain.split(".")[0]).includes(s) || (s.length > 5 && s.includes(slug(domain.split(".")[0])))) n += 2;
  if (slug(`${p.title} ${p.site}`).includes(s)) n += 3;
  if (sources.includes("clearbit")) n += 1;
  if (sources.includes("ddg")) n += 2;
  if (/domain (is )?for sale|buy this domain|parked|coming soon|godaddy|hugedomains|sedo/i.test(`${p.title} ${p.desc}`)) n -= 5;
  return n;
}

async function pool(items, size, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const filter = CHECK ? "AND({Domain}!='', {Domain check}='')" : "AND({Domain}='', {Stage}!='Pre-seed', {Stage}!='Exited')";
let rows = await listAll(EMPLOYERS_BASE, UNIVERSE, { filterByFormula: filter });
if (LIMIT) rows = rows.slice(0, LIMIT);
console.error(`${rows.length} rows`);
const t0 = Date.now();

const result = await pool(rows, CHECK ? 20 : 6, async (r) => {
  const f = r.fields;
  const base = { id: r.id, company: f.Company, sector: f.Sector || "", investors: String(f.Investors || "").slice(0, 80) };
  if (CHECK) { const p = await page(f.Domain); return { ...base, domain: f.Domain, ...(p || { title: null }), nameInPage: p ? slug(`${p.title} ${p.site} ${p.desc}`).includes(slug(f.Company)) : false }; }
  const c = await candidates(f.Company, f.Investors);
  const seen = await pool([...c.entries()], 8, async ([d, src]) => { const p = await page(d); return p ? { domain: p.final || d, src: src.join("+"), score: score(f.Company, d, p, src), title: p.title, desc: p.desc } : null; });
  const best = new Map();
  for (const x of seen.filter(Boolean)) if (!best.has(x.domain) || best.get(x.domain).score < x.score) best.set(x.domain, x);
  return { ...base, candidates: [...best.values()].sort((a, b) => b.score - a.score).slice(0, 4) };
});

if (CHECK) {
  // Second, gentler pass for anything that did not answer: most first-pass misses are our own congestion.
  for (const width of [8, 3]) {
  const miss = result.filter((x) => x.title === null);
  console.error(`retrying ${miss.length} that did not answer, ${width} at a time`);
  await pool(miss, width, async (x) => {
    const p = await page(x.domain, 20000);
    if (p) Object.assign(x, p, { nameInPage: slug(`${p.title} ${p.site} ${p.desc}`).includes(slug(x.company)) });
    else x.error = lastErr || "no answer";
  });
  }
}

mkdirSync("docs/data/enrich/find", { recursive: true });
const file = `docs/data/enrich/find/${CHECK ? "check" : "candidates"}-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(file, JSON.stringify(result, null, 1));
console.error(`${((Date.now() - t0) / 1000).toFixed(0)}s, wrote ${file}`);
