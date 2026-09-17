#!/usr/bin/env node
// Merge duplicate company rows in Startup Universe.
//
// The seed load created one row per fund listing, so a company backed by two
// scraped funds can appear twice. Rows are grouped when they share a domain,
// or share a normalised name and either one has no domain or both domains
// have the same label (causaly.com / causaly.ai). Two rows with the same name
// but clearly different domains are different companies and are left alone.
//
// In each group the most useful row is kept (polled, then verified ATS slug,
// then domain, then UK status, then board coverage). Its blanks are filled
// from the others, Investors / Boards / Source / Notes are combined, Employers
// links are unioned, and the other rows are deleted. Every deleted row is
// written to a backup file first.
//
// Usage:
//   node scripts/dedupe-universe.mjs --dry-run   # report groups, write nothing
//   node scripts/dedupe-universe.mjs             # merge and delete

import { writeFileSync } from "node:fs";
import { loadEnv, listAll, patchAll, airtable, EMPLOYERS_BASE, UNIVERSE, UF as F } from "./lib/airtable.mjs";

loadEnv();
const DRY = process.argv.includes("--dry-run");
const today = new Date().toISOString().slice(0, 10);

const X = { stage: "fldAmrWtBV9JqhqTh", sector: "fldPXY03iXme74QEs", source: "fldsvGL76OgfquHJl", employers: "fld0VJY9B6AMgKmkK" };
const SUFFIX = /\b(limited|ltd|plc|inc|llc|gmbh|sas|bv|ag)\b\.?/g;
const normName = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(SUFFIX, "").replace(/[^a-z0-9]/g, "");
const normDomain = (s) => {
  const d = String(s || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : "";
};
const label = (d) => d.split(".")[0];
const UK = new Set(["London HQ", "London office", "UK (non-London)"]);
const VERIFIED_ATS = new Set(["Ashby", "Greenhouse", "Lever", "Workable", "Teamtailor", "Recruitee"]);

function score(r) {
  const f = r.fields;
  return (f[F.poll] ? 32 : 0) + (VERIFIED_ATS.has(f[F.ats]) && f[F.atsSlug] ? 16 : 0) + (f[F.ats] && !["None found", "Not checked"].includes(f[F.ats]) ? 4 : 0)
    + (normDomain(f[F.domain]) ? 8 : 0) + (UK.has(f[F.londonStatus]) ? 2 : 0) + (f[F.boards] ? 1 : 0);
}

// Union-find over rows.
function groups(rows) {
  const parent = new Map(rows.map((r) => [r.id, r.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  const join = (a, b) => parent.set(find(a), find(b));
  const byDomain = new Map();
  const byName = new Map();
  for (const r of rows) {
    const d = normDomain(r.fields[F.domain]);
    if (d) { if (byDomain.has(d)) join(r.id, byDomain.get(d)); else byDomain.set(d, r.id); }
    const n = normName(r.fields[F.company]);
    if (n.length >= 3) (byName.get(n) || byName.set(n, []).get(n)).push(r);
  }
  for (const list of byName.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = normDomain(list[i].fields[F.domain]);
        const b = normDomain(list[j].fields[F.domain]);
        // Two rows each with their own verified job feed are two companies
        // (Kraken the exchange on kraken.com, Kraken Technologies on kraken.tech).
        const feed = (r) => (VERIFIED_ATS.has(r.fields[F.ats]) && r.fields[F.atsSlug] ? `${r.fields[F.ats]}|${String(r.fields[F.atsSlug]).toLowerCase()}` : "");
        const fa = feed(list[i]);
        const fb = feed(list[j]);
        if (fa && fb && fa !== fb) continue;
        if (!a || !b || a === b || label(a) === label(b)) join(list[i].id, list[j].id);
      }
    }
  }
  const out = new Map();
  for (const r of rows) { const k = find(r.id); (out.get(k) || out.set(k, []).get(k)).push(r); }
  return [...out.values()].filter((g) => g.length > 1);
}

const splitList = (s) => String(s || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const union = (...lists) => [...new Set(lists.flat())];

function merge(group) {
  const sorted = [...group].sort((a, b) => score(b) - score(a));
  const keep = sorted[0];
  const drop = sorted.slice(1);
  const k = keep.fields;
  const fields = {};
  const fill = (id) => { if (!k[id]) { const v = drop.map((d) => d.fields[id]).find(Boolean); if (v) fields[id] = v; } };
  [F.domain, F.hq, X.stage, X.sector, F.careersUrl].forEach(fill);
  if (!UK.has(k[F.londonStatus])) { const v = drop.map((d) => d.fields[F.londonStatus]).find((s) => UK.has(s)); if (v) fields[F.londonStatus] = v; }
  if (!(VERIFIED_ATS.has(k[F.ats]) && k[F.atsSlug])) {
    const src = drop.find((d) => VERIFIED_ATS.has(d.fields[F.ats]) && d.fields[F.atsSlug]);
    if (src) { fields[F.ats] = src.fields[F.ats]; fields[F.atsSlug] = src.fields[F.atsSlug]; }
  }
  if (drop.some((d) => d.fields[F.poll]) && !k[F.poll]) fields[F.poll] = true;
  const investors = union(splitList(k[F.investors]), ...drop.map((d) => splitList(d.fields[F.investors])));
  if (investors.join(", ") !== String(k[F.investors] || "")) fields[F.investors] = investors.join(", ");
  const boards = union(splitList(k[F.boards]), ...drop.map((d) => splitList(d.fields[F.boards])));
  if (boards.length && boards.join(", ") !== String(k[F.boards] || "")) fields[F.boards] = boards.sort().join(", ");
  if (boards.length && k[F.coverage] !== "On a scraped board") fields[F.coverage] = "On a scraped board";
  const sources = union([k[X.source]].filter(Boolean), drop.map((d) => d.fields[X.source]).filter(Boolean));
  if (sources.length > 1) fields[X.source] = sources.join(" | ");
  const links = union(k[X.employers] || [], ...drop.map((d) => d.fields[X.employers] || []));
  if (links.length && links.length !== (k[X.employers] || []).length) fields[X.employers] = links;
  const dropNotes = drop.map((d) => d.fields[F.notes]).filter(Boolean);
  fields[F.notes] = [k[F.notes], ...dropNotes, `${today}: merged duplicate row(s) ${drop.map((d) => `${d.id} (${d.fields[F.company]}${d.fields[F.domain] ? `, ${d.fields[F.domain]}` : ""})`).join(", ")} into this one.`].filter(Boolean).join("\n");
  return { keep, drop, fields };
}

const rows = await listAll(EMPLOYERS_BASE, UNIVERSE, { returnFieldsByFieldId: "true" });
const plans = groups(rows).map(merge);
const dropCount = plans.reduce((a, p) => a + p.drop.length, 0);
const unpopulated = plans.flatMap((p) => p.drop).filter((d) => !normDomain(d.fields[F.domain])).length;
console.log(`${rows.length} rows; ${plans.length} duplicate groups; ${dropCount} rows to remove (${unpopulated} with no domain)`);
for (const p of plans) {
  const fmt = (r) => `${r.fields[F.company]} [${r.fields[F.domain] || "no domain"}${r.fields[F.atsSlug] ? `, ${r.fields[F.ats]}/${r.fields[F.atsSlug]}` : ""}${r.fields[F.poll] ? ", polled" : ""}]`;
  console.log(`  keep ${fmt(p.keep)}  <-  ${p.drop.map(fmt).join("  +  ")}`);
}

const backup = `startup-universe-merged-${today}.json`;
writeFileSync(backup, JSON.stringify(plans.map((p) => ({ kept: p.keep.id, kept_before: p.keep.fields, changes: p.fields, deleted: p.drop.map((d) => ({ id: d.id, fields: d.fields })) })), null, 1));
console.log(`\nBackup of every affected row written to ${backup}`);
if (DRY) process.exit(0);

await patchAll(EMPLOYERS_BASE, UNIVERSE, plans.map((p) => ({ id: p.keep.id, fields: p.fields })));
const ids = plans.flatMap((p) => p.drop.map((d) => d.id));
for (let i = 0; i < ids.length; i += 10) {
  const q = ids.slice(i, i + 10).map((id) => `records[]=${id}`).join("&");
  await airtable(EMPLOYERS_BASE, `${UNIVERSE}?${q}`, { method: "DELETE" });
}
console.log(`Merged ${plans.length} groups and deleted ${ids.length} rows.`);
