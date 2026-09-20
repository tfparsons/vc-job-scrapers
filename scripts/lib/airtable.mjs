// Minimal Airtable REST client for the local scripts. The token comes from
// AIRTABLE_TOKEN in the environment or a gitignored .env in the repo root
// (KEY=value lines, or a file that is just the bare token).

import { readFileSync, existsSync } from "node:fs";

export function loadEnv(file = ".env") {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    else if (/^\s*pat[A-Za-z0-9.]{20,}\s*$/.test(line) && !process.env.AIRTABLE_TOKEN) process.env.AIRTABLE_TOKEN = line.trim();
  }
}

export const EMPLOYERS_BASE = "app4AILlddDnxgRpq";
export const UNIVERSE = "tbloPq3sVvuKuqjmm";

// Startup Universe field ids (stable even if a column is renamed).
export const UF = {
  company: "fldPNxQkfDG0x7ZQx", domain: "fldhpXyCAzRFcmktq", hq: "fldWLCR4jMPtQ4FbE",
  londonStatus: "fldLjy0vgIsivz9hI", investors: "fldcHOuuXcr8QurIb",
  coverage: "fldv2M0Y2Ybhz5UHm", boards: "fldmIeWq1frr0K1Ia",
  careersUrl: "fldq4hyD30EXl4K06", ats: "fldzHpMzt5kykEE0P", atsSlug: "fldaVkmnf6Wp1bXNc",
  poll: "fldQ9UqSBWLCMgGpq", lastVerified: "fldRbPyGPcTyFATrz", notes: "fldWIpxGaH5EpWUWf",
};

export async function airtable(base, table, { method = "GET", params = null, body = null } = {}) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) throw new Error("AIRTABLE_TOKEN is not set (environment or .env)");
  const url = new URL(`https://api.airtable.com/v0/${base}/${table}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  // Airtable occasionally never answers; time out and retry rather than hang.
  // Safe for PATCH too: our writes set fields to fixed values.
  let res;
  for (let attempt = 1; ; attempt += 1) {
    try {
      res = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) { if (attempt >= 4) throw e; }
    if (attempt >= 4) break;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`Airtable ${method} ${table} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

export async function listAll(base, table, params = {}) {
  const records = [];
  let offset = null;
  do {
    const page = await airtable(base, table, { params: { ...params, ...(offset ? { offset } : {}) } });
    records.push(...page.records);
    offset = page.offset || null;
  } while (offset);
  return records;
}

// PATCH in batches of 10 (Airtable's limit), with typecast so select
// option names are accepted as strings.
export async function patchAll(base, table, updates, onProgress = null) {
  for (let i = 0; i < updates.length; i += 10) {
    await airtable(base, table, { method: "PATCH", body: { records: updates.slice(i, i + 10), typecast: true } });
    if (onProgress) onProgress(Math.min(i + 10, updates.length), updates.length);
  }
}
