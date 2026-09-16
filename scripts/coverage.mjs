#!/usr/bin/env node
// Board coverage for Startup Universe (Session C, step 2).
//
// Pulls every active Consider / Getro board's company list through the
// Worker's /companies endpoint, matches Startup Universe rows on domain
// first and normalised name second, and writes Boards + Board coverage on
// every row. Matched rows with a blank Domain or HQ also get those filled
// from the board, since the board is a better source than nothing.
//
// Usage:
//   node scripts/coverage.mjs            # write
//   node scripts/coverage.mjs --dry-run  # report only, no writes
//   WORKER=http://localhost:8787 node scripts/coverage.mjs
//
// AIRTABLE_TOKEN comes from the environment or from a .env file in the repo
// root (gitignored). It needs data.records:read and data.records:write on the
// Employers / Opportunities base. Nothing is stored in the repo.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { HOSTS } from "../src/allowlist.js";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const WORKER = process.env.WORKER || "https://vc-job-scrapers.tfparsons87.workers.dev";
const TOKEN = process.env.AIRTABLE_TOKEN;
const DRY = process.argv.includes("--dry-run");
const EMPLOYERS_BASE = "app4AILlddDnxgRpq";
const UNIVERSE = "tbloPq3sVvuKuqjmm";

// Board display names as they appear in the Sources table, keyed by the
// allowlist source slug. These are what the Boards column shows.
const BOARD_NAMES = {
  notion: "Notion Capital", balderton: "Balderton", phoenixcourt: "Phoenix Court", hoxton: "Hoxton",
  anthemis: "Anthemis", amadeus: "Amadeus Capital", highlandeurope: "Highland Europe", sequoia: "Sequoia",
  dawn: "Dawn Capital", index: "Index Ventures", seedcamp: "Seedcamp", mmc: "MMC", octopus: "Octopus Ventures",
  northzone: "Northzone", accel: "Accel", atomico: "Atomico", ef: "Entrepreneur First",
  generalcatalyst: "General Catalyst", partech: "Partech", cherry: "Cherry Ventures", moonfire: "Moonfire",
  hvcapital: "HV Capital", headline: "Headline", crane: "Crane Venture Partners", pointnine: "Point Nine",
  firstminute: "Firstminute Capital", backed: "Backed VC", outlier: "Outlier Ventures", speedinvest: "Speedinvest",
  techstars: "Techstars", lightspeed: "Lightspeed", creandum: "Creandum", playfair: "Playfair Capital",
  gtmfund: "GTMfund", "point72-ventures": "Point72 Ventures",
};
const HOSTED_BOARDS = ["point72-ventures"];

// Universe field ids (stable even if Tim renames a column).
const F = {
  company: "fldPNxQkfDG0x7ZQx", domain: "fldhpXyCAzRFcmktq", hq: "fldWLCR4jMPtQ4FbE",
  londonStatus: "fldLjy0vgIsivz9hI", investors: "fldcHOuuXcr8QurIb",
  coverage: "fldv2M0Y2Ybhz5UHm", boards: "fldmIeWq1frr0K1Ia", notes: "fldWIpxGaH5EpWUWf",
};

const COVERAGE = {
  on: "On a scraped board",
  notListed: "Investor board scraped, company not listed",
  noBoard: "Investor has no board",
  noVc: "No VC investor known",
};

// How a fund is named on portfolio pages (Investors column) vs its Sources row.
// Matched as a whole-word, case-insensitive substring of the Investors text.
const FUND_ALIASES = {
  "Dawn Capital": ["dawn"], "Balderton": ["balderton"], "Index Ventures": ["index ventures", "index"],
  "Seedcamp": ["seedcamp"], "MMC": ["mmc"], "Octopus Ventures": ["octopus"], "Northzone": ["northzone"],
  "Accel": ["accel"], "Atomico": ["atomico"], "Entrepreneur First": ["entrepreneur first", "ef"],
  "General Catalyst": ["general catalyst"], "Partech": ["partech"], "Cherry Ventures": ["cherry"],
  "Moonfire": ["moonfire"], "HV Capital": ["hv capital", "hv holtzbrinck"], "Headline": ["headline", "e.ventures"],
  "Crane Venture Partners": ["crane"], "Point Nine": ["point nine", "point 9"], "Firstminute Capital": ["firstminute"],
  "Backed VC": ["backed"], "Outlier Ventures": ["outlier"], "Speedinvest": ["speedinvest"], "Techstars": ["techstars"],
  "Lightspeed": ["lightspeed"], "Creandum": ["creandum"], "Playfair Capital": ["playfair"], "GTMfund": ["gtmfund", "gtm fund"],
  "Point72 Ventures": ["point72"], "Notion Capital": ["notion"], "Phoenix Court": ["phoenix court", "localglobe", "latitude"],
  "Hoxton": ["hoxton"], "Anthemis": ["anthemis"], "Amadeus Capital": ["amadeus"], "Highland Europe": ["highland"],
  "Sequoia": ["sequoia"], "Y Combinator": ["y combinator", "yc"], "a16z": ["a16z", "andreessen"],
};

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const normDomain = (s) => {
  if (!s) return null;
  const d = String(s).trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
};
const wordIn = (text, token) => new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text);

async function airtable(base, table, { method = "GET", params = null, body = null } = {}) {
  const url = new URL(`https://api.airtable.com/v0/${base}/${table}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Airtable ${method} ${table} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

async function listAll(base, table, params) {
  const records = [];
  let offset = null;
  do {
    const page = await airtable(base, table, { params: { ...params, ...(offset ? { offset } : {}) } });
    records.push(...page.records);
    offset = page.offset || null;
  } while (offset);
  return records;
}

// Every Consider / Getro host on the allowlist, plus the hosted boards.
// /yc and /a16z have no company list, so they are not here.
function boards() {
  const out = [];
  for (const [host, entry] of Object.entries(HOSTS)) {
    if (entry.platform !== "consider" && entry.platform !== "getro") continue;
    if (entry.hosted) {
      for (const id of HOSTED_BOARDS) out.push({ name: BOARD_NAMES[id] || id, url: `${WORKER}/companies?host=${host}&board=${id}` });
    } else {
      out.push({ name: BOARD_NAMES[entry.source] || entry.source, url: `${WORKER}/companies?host=${host}` });
    }
  }
  return out;
}

async function fetchBoard(board) {
  const res = await fetch(board.url, { signal: AbortSignal.timeout(120000) });
  const json = await res.json();
  return { ...board, ...json };
}

function decide(row, byDomain, byName, scrapedFunds) {
  const domain = normDomain(row.fields[F.domain]);
  const hit = (domain && byDomain.get(domain)) || byName.get(norm(row.fields[F.company])) || null;
  if (hit) return { coverage: COVERAGE.on, boards: [...hit.boards].sort().join(", "), hit };
  const investors = String(row.fields[F.investors] || "");
  if (!investors.trim()) return { coverage: COVERAGE.noVc, boards: "", hit: null };
  const onScraped = scrapedFunds.some((f) => FUND_ALIASES[f] && FUND_ALIASES[f].some((a) => wordIn(investors, a)));
  return { coverage: onScraped ? COVERAGE.notListed : COVERAGE.noBoard, boards: "", hit: null };
}

function londonStatusFrom(location) {
  if (!location) return null;
  const first = location.split(";")[0];
  if (/\blondon\b/i.test(first)) return "London HQ";
  if (/\b(uk|united kingdom|england|scotland|wales)\b/i.test(first)) return "UK (non-London)";
  if (/\blondon\b/i.test(location)) return "London office";
  return null;
}

async function main() {
  if (!TOKEN) throw new Error("AIRTABLE_TOKEN is not set (environment or .env)");
  const list = boards();
  console.log(`${list.length} boards with a company list`);

  const results = [];
  for (const b of list) {
    const r = await fetchBoard(b);
    results.push(r);
    console.log(`  ${r.name.padEnd(24)} ${String(r.counts.fetched).padStart(5)} companies${r.error ? `  ERROR ${r.error}` : ""}`);
  }

  const byDomain = new Map();
  const byName = new Map();
  const add = (map, key, board, company) => {
    if (!key) return;
    const e = map.get(key) || { boards: new Set(), company };
    e.boards.add(board);
    if (!e.company.domain && company.domain) e.company = company;
    map.set(key, e);
  };
  for (const r of results) {
    for (const c of r.companies) {
      add(byDomain, normDomain(c.domain), r.name, c);
      const n = norm(c.name);
      if (n.length >= 4) add(byName, n, r.name, c); // short names ("Star", "Copper") are too ambiguous
    }
  }
  const scrapedFunds = results.filter((r) => !r.error).map((r) => r.name);

  const rows = await listAll(EMPLOYERS_BASE, UNIVERSE, { "returnFieldsByFieldId": "true" });
  const updates = [];
  const tally = {};
  for (const row of rows) {
    const d = decide(row, byDomain, byName, scrapedFunds);
    tally[d.coverage] = (tally[d.coverage] || 0) + 1;
    const fields = {};
    if ((row.fields[F.coverage] || "") !== d.coverage) fields[F.coverage] = d.coverage;
    if ((row.fields[F.boards] || "") !== d.boards) fields[F.boards] = d.boards;
    if (d.hit) {
      const c = d.hit.company;
      if (!row.fields[F.domain] && c.domain) fields[F.domain] = c.domain;
      if (!row.fields[F.hq] && c.location) {
        fields[F.hq] = c.location;
        const status = londonStatusFrom(c.location);
        if (status && (!row.fields[F.londonStatus] || row.fields[F.londonStatus] === "Unknown")) fields[F.londonStatus] = status;
      }
    }
    if (Object.keys(fields).length) updates.push({ id: row.id, fields });
  }

  console.log("\nCoverage:", tally);
  console.log(`${updates.length} of ${rows.length} rows need an update`);
  const report = updates.map((u) => ({ id: u.id, company: rows.find((r) => r.id === u.id).fields[F.company], ...u.fields }));
  writeFileSync("coverage-updates.json", JSON.stringify(report, null, 2));
  console.log("Planned changes written to coverage-updates.json");
  if (DRY) return;

  for (let i = 0; i < updates.length; i += 10) {
    await airtable(EMPLOYERS_BASE, UNIVERSE, { method: "PATCH", body: { records: updates.slice(i, i + 10), typecast: true } });
    if ((i / 10) % 20 === 0) console.log(`  wrote ${Math.min(i + 10, updates.length)}/${updates.length}`);
  }
  console.log("Done.");
}

main().catch((err) => { console.error(err.message); process.exit(1); });
