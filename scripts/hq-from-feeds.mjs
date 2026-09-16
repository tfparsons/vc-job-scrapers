#!/usr/bin/env node
// UK presence from a company's own job feed.
//
// For Startup Universe rows with a verified ATS slug but a blank or Unknown
// London status, fetch the ATS's public feed (same mappers as the Worker)
// and read where the company is hiring. Any role located in London means
// "London office"; any other UK location means "UK (non-London)". Roles only
// elsewhere leave the row as it is, with a dated note, because a company with
// nothing open in the UK today may still have an office. Never overwrites a
// known status or an existing HQ.
//
// Usage:
//   node scripts/hq-from-feeds.mjs --dry-run --limit 10   # pilot, no writes
//   node scripts/hq-from-feeds.mjs                         # all eligible rows

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { FEEDS } from "../src/scrapers/ats-feeds.js";
import { loadEnv, listAll, patchAll, EMPLOYERS_BASE, UNIVERSE, UF as F } from "./lib/airtable.mjs";

loadEnv();
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const UA = "VC-Job-Scrapers/2.3 (personal job search tool; github.com/tfparsons/vc-job-scrapers)";
const PLATFORM = { Ashby: "ashby", Greenhouse: "greenhouse", Lever: "lever", Workable: "workable", Teamtailor: "teamtailor", Recruitee: "recruitee" };

const LONDON = /\blondon\b/i;
const UK = /\b(united kingdom|uk|england|scotland|wales|northern ireland|gb|great britain|manchester|edinburgh|glasgow|bristol|cambridge|oxford|leeds|birmingham|belfast|cardiff)\b/i;

export function presence(listings) {
  const locs = listings.map((l) => l.location || "").filter(Boolean);
  const london = locs.filter((l) => LONDON.test(l) && !/\blondon,\s*(on|ontario|ky|oh)\b/i.test(l));
  const uk = locs.filter((l) => UK.test(l) && !/\bukraine\b/i.test(l));
  if (london.length) return { status: "London office", evidence: london[0], roles: london.length };
  if (uk.length) return { status: "UK (non-London)", evidence: uk[0], roles: uk.length };
  return { status: null, evidence: locs.slice(0, 3).join(" / ") || "no roles open", roles: 0 };
}

async function fetchFeed(platform, slug) {
  const feed = FEEDS[platform];
  let last = "no feed URL answered";
  for (const url of feed.urls(slug)) {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    if (res.status === 404) { last = "HTTP 404"; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return feed.map(text);
  }
  throw new Error(last);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const rows = await listAll(EMPLOYERS_BASE, UNIVERSE, { returnFieldsByFieldId: "true" });
  const todo = rows.filter((r) => {
    const s = r.fields[F.londonStatus];
    return (!s || s === "Unknown") && PLATFORM[r.fields[F.ats]] && r.fields[F.atsSlug];
  }).slice(0, LIMIT);
  console.log(`${todo.length} rows with a verified feed and unknown UK status${DRY ? ", dry run" : ""}`);

  const today = new Date().toISOString().slice(0, 10);
  const updates = [];
  const report = [];
  const tally = {};
  for (const row of todo) {
    const company = row.fields[F.company];
    const platform = PLATFORM[row.fields[F.ats]];
    let p;
    try {
      p = presence(await fetchFeed(platform, row.fields[F.atsSlug]));
    } catch (err) {
      p = { status: null, evidence: `feed error: ${err.message}`, roles: 0 };
    }
    const k = p.status || "no UK roles";
    tally[k] = (tally[k] || 0) + 1;
    report.push({ company, platform, ...p });
    console.log(`  ${String(company).padEnd(26)} ${(p.status || "-").padEnd(16)} ${p.roles} UK roles; e.g. ${String(p.evidence).slice(0, 70)}`);
    const note = p.status
      ? `${today}: UK presence from ${row.fields[F.ats]} feed: ${p.roles} UK role(s), e.g. ${p.evidence}`
      : `${today}: ${row.fields[F.ats]} feed shows no UK roles (${String(p.evidence).slice(0, 120)})`;
    const fields = { [F.notes]: [row.fields[F.notes], note].filter(Boolean).join("\n") };
    if (p.status) {
      fields[F.londonStatus] = p.status;
      if (!row.fields[F.hq]) fields[F.hq] = `${p.evidence} (from job feed)`;
    }
    updates.push({ id: row.id, fields });
    await sleep(250);
  }
  writeFileSync("hq-feeds-report.json", JSON.stringify(report, null, 2));
  console.log("\nResults:", tally, "-> hq-feeds-report.json");
  if (DRY) return;
  await patchAll(EMPLOYERS_BASE, UNIVERSE, updates, (n, t) => { if (n % 100 === 0 || n === t) console.log(`  wrote ${n}/${t}`); });
  console.log("Done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err.message); process.exit(1); });
