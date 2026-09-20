#!/usr/bin/env node
// Recipe-driven Airtable enrichment. Code gathers the evidence, a model judges
// it in bulk only where judgement is needed, and answers are routed by
// confidence. No agent ever browses per row.
//
//   node scripts/enrich.mjs status  --recipe domain
//   node scripts/enrich.mjs gather  --recipe domain [--limit 10]
//   node scripts/enrich.mjs prompt  --recipe domain --chunk 1      (only for recipes with judge: "model")
//   node scripts/enrich.mjs apply   --recipe domain [--dry-run]
//   node scripts/enrich.mjs promote --recipe domain                (copy candidates Tim marked Approved)
//
// State lives in Airtable: a row needs work while it matches the recipe's
// filter, and apply always writes something that takes it out of the filter.
// enrich/work/<recipe>/ holds this run's files only and is not committed.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, listAll, patchAll } from "./lib/airtable.mjs";
import { GATHERERS, homepage, pool } from "./lib/gather.mjs";

loadEnv();
const [cmd, ...args] = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const name = opt("--recipe");
if (!cmd || !name) { console.error("usage: enrich.mjs <status|gather|prompt|apply|promote> --recipe <name>"); process.exit(1); }

const recipe = JSON.parse(readFileSync(join("enrich", "recipes", `${name}.json`), "utf8"));
const WORK = join("enrich", "work", name);
const LOG = join("docs", "data", "enrich", name);
const today = new Date().toISOString().slice(0, 10);
const o = recipe.output;
const rv = recipe.review; // { candidateField, confidenceField } or undefined
const LABEL = { high: "High", medium: "Medium", low: "Low" };
const rows = (formula) => listAll(recipe.base, recipe.table, { filterByFormula: formula });
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

// ---------- verification by output type ----------
const normDomain = (s) => { const d = String(s || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0]; return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null; };
async function verify(value) {
  if (o.type === "domain") { const d = normDomain(value); if (!d) return { why: "not a domain" }; return (await homepage(d)).error ? { why: "site did not answer" } : { value: d }; }
  if (o.type === "select") { const hit = (o.options || []).find((x) => x.toLowerCase() === String(value || "").trim().toLowerCase()); return hit ? { value: hit } : { why: `not one of: ${o.options.join(", ")}` }; }
  if (o.type === "url") { const v = String(value || "").trim(); return new RegExp(o.pattern || "^https?://\\S+$", "i").test(v) ? { value: v } : { why: "not a matching URL" }; }
  const v = String(value || "").trim().slice(0, o.maxLength || 2000);
  return v ? { value: v } : { why: "empty" };
}

if (cmd === "status") {
  console.log(`${recipe.name}: ${(await rows(recipe.filter)).length} rows still need it`);
  if (rv) for (const s of ["High", "Medium", "Low", "Couldn't fetch", "Approved", "Rejected"]) console.log(`  ${s}: ${(await rows(`{${rv.confidenceField}}="${s}"`)).length}`);
}

if (cmd === "gather") {
  const g = recipe.gather;
  let need = await rows(recipe.filter);
  if (opt("--limit")) need = need.slice(0, Number(opt("--limit")));
  console.error(`${need.length} rows, gatherer ${g.type}`);
  rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });
  const t0 = Date.now();
  const run = (r) => GATHERERS[g.type](r.fields, g).then((x) => ({ id: r.id, ...Object.fromEntries(recipe.inputs.map((k) => [k, String(r.fields[k] ?? "").slice(0, 80)])), ...x }));
  const out = await pool(need, g.concurrency || 12, run);
  // Most first-pass misses are our own congestion, so retry failures gently.
  for (const width of [6, 3]) { const miss = out.map((x, i) => (x.failed ? i : -1)).filter((i) => i >= 0); if (!miss.length) break; console.error(`retrying ${miss.length}, ${width} at a time`); await pool(miss, width, async (i) => { out[i] = await run(need[i]); }); }
  const decided = out.filter((x) => x.verdict).map((x) => ({ id: x.id, ...x.verdict }));
  const open = out.filter((x) => !x.verdict).map(({ failed, ...x }) => x);
  writeFileSync(join(WORK, "verdict-code.json"), JSON.stringify(decided, null, 1));
  const size = recipe.chunkSize || 300;
  for (let i = 0; i * size < open.length; i++) writeFileSync(join(WORK, `judge-${i + 1}.json`), JSON.stringify(open.slice(i * size, (i + 1) * size)));
  console.error(`${((Date.now() - t0) / 1000).toFixed(0)}s. Decided in code: ${decided.length}. For a model to judge: ${open.length} in ${Math.ceil(open.length / size)} chunk(s) under ${WORK}/`);
}

if (cmd === "prompt") {
  const n = opt("--chunk", "1");
  const shape = o.type === "select" ? `one of: ${o.options.join(" | ")}` : o.type === "domain" ? "a bare domain (lowercase, no www, no path) or null" : o.type === "url" ? "a full https URL or null" : "a short plain-text value or null";
  console.log(`Work in ${process.cwd()}. Do NOT use any web tools and do not spawn agents. Use only Read and Write.

Read ${join(WORK, `judge-${n}.json`)} (in pieces if large; cover every entry). Each entry is one company with the fields ${recipe.inputs.join(", ")} and an "evidence" object that a script collected.

For EACH entry:
${recipe.instruction.trim()}

Write ${join(WORK, `verdict-${n}.json`)} as a JSON array, one object per input entry, same order, exactly {"id","value","confidence","evidence"}.
- "value" is ${shape}.
- "confidence": "high" only when the evidence clearly settles it; "medium" when it probably does; "low" (with value null unless told otherwise) when it does not.
- "evidence": one sentence, 20 words at most, quoting a few words of what you saw.
Judge only from the evidence given, never from memory of the company. Every input id exactly once. Check the file parses and the count matches. Reply with only the counts of high, medium and low.`);
}

if (cmd === "apply") {
  const dry = args.includes("--dry-run");
  const live = new Map((await rows(recipe.filter)).map((r) => [r.id, r]));
  const verdicts = readdirSync(WORK).filter((f) => /^verdict-.*\.json$/.test(f)).flatMap((f) => readJson(join(WORK, f)));
  const tally = { written: 0, forReview: 0, couldNotFetch: 0, rejected: 0, skipped: 0 };
  const updates = []; const report = [];
  for (const a of verdicts) {
    const row = live.get(a.id);
    if (!row) { tally.skipped += 1; continue; }
    const fields = {}; let line;
    const v = a.value == null ? { why: "no answer" } : await verify(a.value);
    const conf = LABEL[a.confidence] || "Low";
    if (v.value != null && (conf === "High" || !rv)) {
      tally.written += 1; fields[o.field] = v.value; if (rv) fields[rv.confidenceField] = "High";
      line = `${today}: ${recipe.name}: ${v.value} (${a.confidence}): ${a.evidence}`;
    } else if (v.value != null) {
      tally.forReview += 1; fields[rv.candidateField] = v.value; fields[rv.confidenceField] = conf;
      line = `${today}: ${recipe.name}: candidate ${v.value} (${a.confidence}) for review: ${a.evidence}`;
    } else if (rv) {
      if (a.value != null) tally.rejected += 1; else tally.couldNotFetch += 1;
      fields[rv.confidenceField] = "Couldn't fetch";
      line = a.value != null ? `${today}: ${recipe.name}: "${a.value}" rejected, ${v.why}: ${a.evidence}` : null;
    } else { tally.rejected += 1; continue; }
    if (line && recipe.notes) fields[recipe.notes] = [row.fields[recipe.notes] || "", line].filter(Boolean).join("\n");
    updates.push({ id: a.id, fields });
    report.push({ id: a.id, company: row.fields[recipe.inputs[0]], ...fields, [recipe.notes]: undefined, evidence: a.evidence });
  }
  console.log(tally);
  if (dry) { console.log("dry run, nothing written"); process.exit(0); }
  await patchAll(recipe.base, recipe.table, updates);
  mkdirSync(LOG, { recursive: true });
  writeFileSync(join(LOG, `applied-${today}.json`), JSON.stringify(report, null, 1));
  console.log(`wrote ${updates.length} rows`);
}

if (cmd === "promote") {
  if (!rv) { console.error("recipe has no review fields"); process.exit(1); }
  const ok = await rows(`AND({${rv.confidenceField}}="Approved", {${rv.candidateField}}!="")`);
  const updates = ok.map((r) => ({ id: r.id, fields: { [o.field]: r.fields[rv.candidateField], [rv.candidateField]: null, [rv.confidenceField]: "High", ...(recipe.notes ? { [recipe.notes]: [r.fields[recipe.notes] || "", `${today}: ${recipe.name}: ${r.fields[rv.candidateField]} approved by Tim`].filter(Boolean).join("\n") } : {}) } }));
  await patchAll(recipe.base, recipe.table, updates);
  console.log(`promoted ${updates.length} approved candidates into ${o.field}`);
}
