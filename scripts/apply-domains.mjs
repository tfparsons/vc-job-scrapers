#!/usr/bin/env node
// Apply domain-resolution results to Startup Universe (Session C, step 3).
//
// Input: JSON files of {id, company, domain, confidence, evidence} produced
// by the web-search resolution pass (one file per batch). For each row with
// a high or medium confidence domain, check the site answers (HTTPS GET on
// the bare domain or www., 10 s), then write Domain. Rows with no usable
// domain get a dated Notes line so the miss is visible and not retried
// blindly. Never overwrites an existing Domain.
//
// Usage:
//   node scripts/apply-domains.mjs <dir-or-files...>            # write
//   node scripts/apply-domains.mjs --dry-run <dir-or-files...>  # report only

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, listAll, patchAll, EMPLOYERS_BASE, UNIVERSE, UF as F } from "./lib/airtable.mjs";

loadEnv();
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const inputs = args.filter((a) => !a.startsWith("--"));
if (!inputs.length) { console.error("usage: apply-domains.mjs [--dry-run] <out-*.json or directory>"); process.exit(1); }

const files = inputs.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => /^out-.*\.json$/.test(f)).map((f) => join(p, f)) : [p]));
const results = files.flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
console.log(`${results.length} results from ${files.length} files`);

const normDomain = (s) => {
  if (!s) return null;
  const d = String(s).trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
};

async function alive(domain) {
  for (const host of [domain, `www.${domain}`]) {
    try {
      const res = await fetch(`https://${host}/`, { headers: { "user-agent": "VC-Job-Scrapers/2.1 (personal job search tool)" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
      if (res.status < 500) return { ok: true, status: res.status, final: new URL(res.url).host };
    } catch { /* try next */ }
  }
  return { ok: false };
}

async function mapPool(items, fn, limit) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const rows = new Map((await listAll(EMPLOYERS_BASE, UNIVERSE, { returnFieldsByFieldId: "true" })).map((r) => [r.id, r]));
const today = new Date().toISOString().slice(0, 10);
const updates = [];
const tally = { written: 0, dead: 0, unresolved: 0, notSearched: 0, skippedExisting: 0, unknownId: 0 };
const report = [];

await mapPool(results, async (r) => {
  const row = rows.get(r.id);
  if (!row) { tally.unknownId += 1; return; }
  if (row.fields[F.domain]) { tally.skippedExisting += 1; return; }
  const domain = normDomain(r.domain);
  // Answers given from memory rather than a live search are not evidence.
  const fromMemory = /prior knowledge|general knowledge|from memory|not searched|budget exhausted|unverified live|could not be (?:live )?(?:searched|verified)/i.test(r.evidence || "");
  const usable = domain && !fromMemory && (r.confidence === "high" || r.confidence === "medium");
  const fields = {};
  if (usable) {
    const a = await alive(domain);
    if (a.ok) {
      fields[F.domain] = domain;
      if (r.confidence === "medium") fields[F.notes] = [row.fields[F.notes], `${today}: domain ${domain} from web search, medium confidence: ${r.evidence}`].filter(Boolean).join("\n");
      tally.written += 1;
      report.push({ company: r.company, domain, confidence: r.confidence, status: `live ${a.status}` });
    } else {
      fields[F.notes] = [row.fields[F.notes], `${today}: domain ${domain} suggested by web search but the site did not answer: ${r.evidence}`].filter(Boolean).join("\n");
      tally.dead += 1;
      report.push({ company: r.company, domain, confidence: r.confidence, status: "dead" });
    }
  } else if (fromMemory || !r.evidence) {
    // Not actually looked up: leave the row untouched so a later pass tries it.
    tally.notSearched += 1;
    report.push({ company: r.company, domain: null, confidence: r.confidence, status: "not searched" });
    return;
  } else {
    fields[F.notes] = [row.fields[F.notes], `${today}: domain not resolved by web search: ${r.evidence}`].filter(Boolean).join("\n");
    tally.unresolved += 1;
    report.push({ company: r.company, domain: null, confidence: r.confidence, status: "unresolved" });
  }
  updates.push({ id: r.id, fields });
}, 6);

console.log("Tally:", tally);
writeFileSync("domain-updates.json", JSON.stringify(report, null, 2));
console.log("Details written to domain-updates.json");
if (DRY) process.exit(0);
await patchAll(EMPLOYERS_BASE, UNIVERSE, updates, (n, t) => { if (n % 100 === 0 || n === t) console.log(`  wrote ${n}/${t}`); });
console.log("Done.");
