// Y Combinator's Work at a Startup (www.workatastartup.com). The public page
// only shows a 30-job teaser, but /jobs/search?q=<term> answers JSON to anyone
// who sends Accept: application/json: {"jobs": [...]}, 30 results per query,
// no pagination, no posted date. Validated live 3 Sep 2026.
//
// The search matches location text as well as titles, so a couple of
// location words are added to the term loop to surface UK roles the title
// terms alone would miss.

import { runFilters } from "../lib/filter.js";
import { fetchWithUA, mapPool } from "../lib/http.js";
import { clean } from "../lib/html.js";

export const YC_HOST = "www.workatastartup.com";
export const YC_EXTRA_TERMS = ["london", "united kingdom"];

// ---------- pure mapping (unit-tested against a fixture) ----------

export function mapYcJob(job) {
  const id = job && (typeof job.id === "number" || typeof job.id === "string") ? String(job.id) : null;
  return {
    company: clean(job.companyName),
    title: clean(job.title),
    location: clean(job.location),
    posted_date: null, // the board does not expose one
    posted_relative: null,
    seniority: null,
    // `salary` is the whole-line string the board displays, e.g. "$124K - $188K CAD".
    salary_raw: clean(job.salary),
    remote: null,
    link: id ? `https://${YC_HOST}/jobs/${id}` : null,
  };
}

export function mapYcJobs(json) {
  const jobs = json && Array.isArray(json.jobs) ? json.jobs : [];
  return jobs.map(mapYcJob);
}

// ---------- network ----------

async function searchTerm(term, fetchImpl) {
  const url = `https://${YC_HOST}/jobs/search?q=${encodeURIComponent(term)}`;
  const res = await fetchWithUA(url, { headers: { accept: "application/json" } }, fetchImpl);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${term}`);
  if (json === null) throw new Error(`non-JSON response for ${term}`);
  return mapYcJobs(json);
}

export async function scrapeYc({ now, config, fetch: fetchImpl = globalThis.fetch }) {
  const terms = [...new Set([...config.terms, ...YC_EXTRA_TERMS])];
  const results = await mapPool(terms, (term) => searchTerm(term, fetchImpl));

  const hits = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.ok) hits.push({ term: terms[i], listings: r.value });
    else failures.push(r.error);
  });

  if (hits.length === 0) {
    return { listings: [], counts: null, error: `yc: ${failures[0] || "no results"}` };
  }

  const { listings, counts } = runFilters(hits, {
    locationRules: config.location_keep ? { keep: config.location_keep, remoteExclude: config.remote_exclude || [] } : null,
    maxAgeDays: config.max_age_days,
    now,
  });
  const error = failures.length
    ? `partial: ${failures.length}/${terms.length} term fetches failed: ${failures[0]}`
    : null;
  return { listings, counts, error };
}
