#!/usr/bin/env node
// Recipe-driven Airtable enrichment, paid for in session tokens.
//
// A recipe (enrich/recipes/<name>.json) says which rows need a value, which
// fields the researcher sees, what to write back and how to check it. The
// loop is: export a batch to disk, have subagents research it with web
// search or page reads, apply the answers after verification. One batch per
// session (web search is capped per session); the next session continues
// from the files on disk, so nothing is lost if a session stops mid-batch.
//
//   node scripts/enrich.mjs status --recipe domain-check
//   node scripts/enrich.mjs export --recipe domain-check --size 10
//   node scripts/enrich.mjs prompt --recipe domain-check --batch <file> --from 1 --to 10 --out <file>
//   node scripts/enrich.mjs apply  --recipe domain-check [--dry-run]
//
// Answers are JSON arrays of {id, value, confidence, evidence}. An entry whose
// evidence says it was not searched goes back into the queue.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, listAll, patchAll } from "./lib/airtable.mjs";

loadEnv();
const [cmd, ...args] = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const flag = (k) => args.includes(k);
const name = opt("--recipe");
if (!cmd || !name) { console.error("usage: enrich.mjs <status|export|prompt|apply> --recipe <name> [...]"); process.exit(1); }

const recipe = JSON.parse(readFileSync(join("enrich", "recipes", `${name}.json`), "utf8"));
const DIR = join("docs", "data", "enrich", name);
mkdirSync(DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const RANK = { high: 3, medium: 2, low: 1 };
const NOT_SEARCHED = /prior knowledge|general knowledge|from memory|not searched|budget exhausted|unverified live/i;

function answers() {
  const out = new Map();
  for (const f of readdirSync(DIR).filter((n) => /^out-.*\.json$/.test(n)).sort()) {
    for (const r of JSON.parse(readFileSync(join(DIR, f), "utf8"))) {
      if (!r.id || !r.evidence || NOT_SEARCHED.test(r.evidence)) continue;
      out.set(r.id, { ...r, value: r.value ?? r.domain ?? null, file: f });
    }
  }
  return out;
}

const needRows = () => listAll(recipe.base, recipe.table, { filterByFormula: recipe.filter });

// ---------- verification by output type ----------
const normDomain = (s) => {
  const d = String(s || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
};
async function alive(domain) {
  for (const host of [domain, `www.${domain}`]) {
    try {
      const res = await fetch(`https://${host}/`, { headers: { "user-agent": "VC-Job-Scrapers/2.3 (personal job search tool)" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
      if (res.status < 500) return true;
    } catch { /* next */ }
  }
  return false;
}
async function verify(a) {
  const o = recipe.output;
  if (o.type === "domain") {
    const d = normDomain(a.value);
    if (!d) return { ok: false, why: "not a domain" };
    return (await alive(d)) ? { ok: true, value: d } : { ok: false, why: "site did not answer" };
  }
  if (o.type === "select") {
    const hit = (o.options || []).find((x) => x.toLowerCase() === String(a.value || "").trim().toLowerCase());
    return hit ? { ok: true, value: hit } : { ok: false, why: `not one of: ${o.options.join(", ")}` };
  }
  if (o.type === "url") {
    const v = String(a.value || "").trim();
    const re = o.pattern ? new RegExp(o.pattern, "i") : /^https?:\/\/\S+$/i;
    return re.test(v) ? { ok: true, value: v } : { ok: false, why: "not a matching URL" };
  }
  const v = String(a.value || "").trim().slice(0, o.maxLength || 2000);
  return v ? { ok: true, value: v } : { ok: false, why: "empty" };
}

// ---------- commands ----------
if (cmd === "status") {
  const rows = await needRows();
  const done = answers();
  const pending = rows.filter((r) => !done.has(r.id));
  console.log(`${recipe.name}: ${rows.length} rows match the filter; ${done.size} answered on disk (not yet applied or failed verification); ${pending.length} still to research`);
}

if (cmd === "export") {
  const size = Number(opt("--size", recipe.batchSize || 100));
  const rows = await needRows();
  const done = answers();
  const batch = rows.filter((r) => !done.has(r.id)).slice(0, size).map((r) => Object.fromEntries([["id", r.id], ...recipe.inputs.map((f) => [f, r.fields[f] ?? ""])]));
  const n = readdirSync(DIR).filter((f) => /^batch-\d+\.json$/.test(f)).length + 1;
  const file = join(DIR, `batch-${String(n).padStart(2, "0")}.json`);
  writeFileSync(file, JSON.stringify(batch, null, 1));
  console.log(`${rows.length - done.size} rows still need ${recipe.name}; wrote ${batch.length} to ${file}`);
}

if (cmd === "prompt") {
  const batch = opt("--batch");
  const from = opt("--from", "1");
  const to = opt("--to");
  const out = opt("--out");
  const o = recipe.output;
  const shape = o.type === "select" ? `one of: ${o.options.join(" | ")}` : o.type === "domain" ? "the bare registrable domain, lowercase, no www, no path" : o.type === "url" ? "a full https URL" : "a short plain-text value";
  console.log(`Read ${batch}. Handle entries ${from} to ${to} only (1-based, in file order).

For EACH entry:
${recipe.instruction.trim()}

Rules that always apply:
- Use at most ${recipe.searchesPerRow || 1} WebSearch call(s) per entry. Reading a page with WebFetch is fine and does not count.
- "value" is ${shape}. Set it to null when there is no clear answer.
- "confidence": "high" when the evidence is the company's own site or an equally direct source; "medium" when a third-party page states it or the match is partial; "low" when ambiguous or nothing found.
- "evidence": one sentence naming what you saw and where. Never answer from memory: if you could not look, say so.
- If the WebSearch budget runs out, STOP and write every remaining entry as value null, confidence "low", evidence "not searched (budget exhausted)".

Write ${out} as a JSON array with one object per input entry, in the same order, exactly {"id","value","confidence","evidence"}. Every input id exactly once. Reply with just the counts of high, medium and low.`);
}

if (cmd === "apply") {
  const dry = flag("--dry-run");
  const rows = new Map((await needRows()).map((r) => [r.id, r]));
  const done = answers();
  const updates = [];
  const tally = { written: 0, rejected: 0, lowConfidence: 0, alreadyFilled: 0 };
  const report = [];
  const min = RANK[recipe.minConfidence || "medium"];
  for (const [id, a] of done) {
    const row = rows.get(id);
    if (!row) { tally.alreadyFilled += 1; continue; }
    const notes = row.fields[recipe.notes] || "";
    let line;
    let fields = {};
    if ((RANK[a.confidence] || 0) < min || a.value == null) {
      tally.lowConfidence += 1;
      line = `${today}: ${recipe.name}: no confident answer (${a.confidence}): ${a.evidence}`;
    } else {
      const v = await verify(a);
      if (v.ok) {
        tally.written += 1;
        fields[recipe.output.field] = v.value;
        line = `${today}: ${recipe.name}: ${v.value} (${a.confidence}): ${a.evidence}`;
      } else {
        tally.rejected += 1;
        line = `${today}: ${recipe.name}: answer "${a.value}" rejected, ${v.why}: ${a.evidence}`;
      }
    }
    if (recipe.notes) fields[recipe.notes] = [notes, line].filter(Boolean).join("\n");
    updates.push({ id, fields });
    report.push({ id, company: row.fields[recipe.inputs[0]], value: fields[recipe.output.field] ?? null, line });
  }
  console.log(tally);
  for (const r of report.slice(0, 40)) console.log(`  ${String(r.company).padEnd(26)} ${r.value == null ? "-" : r.value}`);
  writeFileSync(join(DIR, `applied-${today}.json`), JSON.stringify(report, null, 1));
  if (dry) { console.log("dry run, nothing written"); process.exit(0); }
  await patchAll(recipe.base, recipe.table, updates);
  console.log(`wrote ${updates.length} rows`);
}
