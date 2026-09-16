#!/usr/bin/env node
// UK presence from Companies House (Session C step 3, HQ half).
//
// For Startup Universe rows whose London status is blank or Unknown, search
// Companies House by company name and accept a match only when exactly one
// ACTIVE company has the same normalised name (legal suffixes stripped).
// A match proves a UK legal entity and gives its registered office, which is
// often an accountant's address rather than the real office, so it is
// recorded honestly: HQ = "<locality> (Companies House registered office)",
// London status = "London office" for a London postcode, otherwise
// "UK (non-London)". Never overwrites an existing HQ or a known London status.
//
// Pilot 16 Sep 2026 (10 rows): 4 matches, of which at least 2 were clearly a
// different company sharing a common name (Sama, AQMetrics). Name-only
// matching is weak for short or common names; prefer scripts/hq-from-feeds.mjs
// for rows with a verified ATS feed, and review this script's output by hand.
//
// Usage:
//   node scripts/hq-enrich.mjs --dry-run --limit 10      # pilot, no writes
//   node scripts/hq-enrich.mjs --pollable                # only rows with a verified ATS slug (unlocks polling)
//   node scripts/hq-enrich.mjs                           # every blank / Unknown row
//
// COMPANIES_HOUSE_KEY comes from the environment or .env. Raw search
// responses are saved to hq-raw.json so matching can be re-scored offline.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadEnv, listAll, patchAll, EMPLOYERS_BASE, UNIVERSE, UF as F } from "./lib/airtable.mjs";

loadEnv();
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const POLLABLE = args.includes("--pollable");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const KEY = process.env.COMPANIES_HOUSE_KEY;
if (!KEY) { console.error("COMPANIES_HOUSE_KEY is not set (environment or .env)"); process.exit(1); }

const SUPPORTED_ATS = new Set(["Ashby", "Greenhouse", "Lever", "Workable", "Teamtailor", "Recruitee"]);
const SUFFIX = /\b(limited|ltd|plc|llp|uk|u\.k\.|holdings|group|technologies|technology|labs|ai|io|hq|inc|company|co)\b\.?/g;
export const normName = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/\([^)]*\)/g, " ").replace(SUFFIX, " ").replace(/[^a-z0-9]/g, "");

// London postcode areas: E, EC, N, NW, SE, SW, W, WC followed by a digit.
const LONDON_POSTCODE = /^(E|EC|N|NW|SE|SW|W|WC)\d/i;

async function search(name) {
  const u = new URL("https://api.company-information.service.gov.uk/search/companies");
  u.searchParams.set("q", name);
  u.searchParams.set("items_per_page", "20");
  const res = await fetch(u, { headers: { authorization: `Basic ${btoa(`${KEY}:`)}` }, signal: AbortSignal.timeout(20000) });
  if (res.status === 401) throw new Error("401: Companies House rejected the key (it must be a REST key for the live service)");
  if (res.status === 429) throw new Error("429: rate limited");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).items || [];
}

export function decide(company, items) {
  const key = normName(company);
  if (key.length < 3) return { verdict: "name too short to match" };
  // FC / NF / SF numbers are overseas companies registered in the UK, and
  // their address is abroad (pilot: AQMetrics, Maynooth). Not UK presence.
  const exact = items.filter((i) => normName(i.title) === key && !/^(FC|NF|SF)/.test(String(i.company_number || "")));
  const active = exact.filter((i) => i.company_status === "active");
  if (active.length === 0) return { verdict: exact.length ? `only ${exact.map((i) => i.company_status).join("/")} matches` : "no exact name match" };
  if (active.length > 1) return { verdict: `${active.length} active companies share the name` };
  const hit = active[0];
  const a = hit.address || {};
  const postcode = String(a.postal_code || "").trim();
  const locality = String(a.locality || "").trim() || (postcode ? postcode.split(" ")[0] : "");
  const london = LONDON_POSTCODE.test(postcode) || /^london$/i.test(locality);
  return {
    verdict: "match",
    number: hit.company_number,
    title: hit.title,
    hq: `${locality || "UK"} (Companies House registered office)`,
    londonStatus: london ? "London office" : "UK (non-London)",
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const rows = await listAll(EMPLOYERS_BASE, UNIVERSE, { returnFieldsByFieldId: "true" });
  const todo = rows.filter((r) => {
    const status = r.fields[F.londonStatus];
    if (status && status !== "Unknown") return false;
    if (r.fields[F.hq]) return false;
    if (POLLABLE && !(SUPPORTED_ATS.has(r.fields[F.ats]) && r.fields[F.atsSlug])) return false;
    return true;
  }).slice(0, LIMIT);
  console.log(`${todo.length} rows to check${POLLABLE ? " (verified ATS slug only)" : ""}${DRY ? ", dry run" : ""}`);

  const today = new Date().toISOString().slice(0, 10);
  const raw = [];
  const report = [];
  const updates = [];
  const tally = {};
  for (const row of todo) {
    const company = row.fields[F.company];
    let items;
    try { items = await search(company); } catch (err) { console.error(`  ${company}: ${err.message}`); if (/401|429/.test(err.message)) break; continue; }
    raw.push({ id: row.id, company, items: items.map((i) => ({ title: i.title, company_number: i.company_number, company_status: i.company_status, address: i.address, date_of_creation: i.date_of_creation })) });
    const d = decide(company, items);
    tally[d.verdict === "match" ? d.londonStatus : "no match"] = (tally[d.verdict === "match" ? d.londonStatus : "no match"] || 0) + 1;
    report.push({ company, domain: row.fields[F.domain] || null, ...d });
    console.log(`  ${String(company).padEnd(28)} ${d.verdict === "match" ? `${d.londonStatus.padEnd(16)} ${d.title} (${d.number}) ${d.hq}` : d.verdict}`);
    const fields = { [F.notes]: [row.fields[F.notes], `${today}: Companies House: ${d.verdict === "match" ? `${d.title} ${d.number}, registered office ${d.hq.replace(" (Companies House registered office)", "")}` : d.verdict}`].filter(Boolean).join("\n") };
    if (d.verdict === "match") { fields[F.hq] = d.hq; fields[F.londonStatus] = d.londonStatus; }
    updates.push({ id: row.id, fields });
    await sleep(550); // 600 requests per 5 minutes
  }
  writeFileSync("hq-raw.json", JSON.stringify(raw, null, 1));
  writeFileSync("hq-report.json", JSON.stringify(report, null, 2));
  console.log("\nResults:", tally, "-> hq-report.json, raw responses in hq-raw.json");
  if (DRY) return;
  await patchAll(EMPLOYERS_BASE, UNIVERSE, updates, (n, t) => { if (n % 100 === 0 || n === t) console.log(`  wrote ${n}/${t}`); });
  console.log("Done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err.message); process.exit(1); });
