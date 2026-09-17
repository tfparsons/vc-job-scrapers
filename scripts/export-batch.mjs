#!/usr/bin/env node
// Export the next batch of Startup Universe rows that need an enrichment,
// for a Claude session to research with web search. One batch per session,
// sized under the session's search cap (about 200 searches, shared across
// every subagent), so the loop is: export, research, apply, new session.
//
// Usage:
//   node scripts/export-batch.mjs --need domain --size 120 --out <dir>
//
// --need    which enrichment is missing: domain (more to come: stage, hq)
// --size    rows per batch (default 120; one search per row leaves headroom)
// --out     directory holding earlier out-*.json files; rows already
//           answered there (any confidence) are skipped, so a re-export after
//           a partial run only returns what is still open
//
// Writes <out>/batch-<n>.json as [{id, company, investors, sector, stage}]
// and prints the path. Domain batches use the same eligibility as the
// Airtable AI field: blank Domain, Stage not Pre-seed or Exited.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, listAll, EMPLOYERS_BASE, UNIVERSE, UF as F } from "./lib/airtable.mjs";

loadEnv();
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const NEED = opt("--need", "domain");
const SIZE = Number(opt("--size", 120));
const OUT = opt("--out", "batches");
const STAGE = "fldAmrWtBV9JqhqTh";
const SECTOR = "fldPXY03iXme74QEs";

const NEEDS = {
  domain: (r) => !r.fields[F.domain] && !["Pre-seed", "Exited"].includes(r.fields[STAGE]),
};
if (!NEEDS[NEED]) { console.error(`unknown --need ${NEED}; known: ${Object.keys(NEEDS).join(", ")}`); process.exit(1); }

mkdirSync(OUT, { recursive: true });
const done = new Set();
for (const f of readdirSync(OUT).filter((n) => /^out-.*\.json$/.test(n))) {
  for (const r of JSON.parse(readFileSync(join(OUT, f), "utf8"))) if (r.id) done.add(r.id);
}

const rows = await listAll(EMPLOYERS_BASE, UNIVERSE, { returnFieldsByFieldId: "true" });
const open = rows.filter((r) => NEEDS[NEED](r) && !done.has(r.id));
const batch = open.slice(0, SIZE).map((r) => ({
  id: r.id, company: r.fields[F.company], investors: r.fields[F.investors] || "", sector: r.fields[SECTOR] || "", stage: r.fields[STAGE] || "",
}));
const n = readdirSync(OUT).filter((f) => /^batch-\d+\.json$/.test(f)).length + 1;
const file = join(OUT, `batch-${String(n).padStart(2, "0")}.json`);
writeFileSync(file, JSON.stringify(batch, null, 1));
console.log(`${open.length} rows still need ${NEED} (${done.size} answered in earlier batches); wrote ${batch.length} to ${file}`);
