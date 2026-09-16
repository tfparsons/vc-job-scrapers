// /companies?host=<board>: every company a board lists, so Startup Universe
// rows can be marked as covered or not. Two platforms, both validated live on
// 16 Sep 2026:
//   Getro: GET https://{host}/companies is a Next.js page whose __NEXT_DATA__
//     carries the network id; POST api.getro.com/api/v2/collections/{id}/
//     search/companies with hits_per_page returns the list, no auth needed.
//     A 2,879-company board (Techstars) comes back in one page at 5000.
//   Consider: the same session as the jobs search (page cookies + CSRF token),
//     then POST /api-boards/search-companies, paged with meta.sequence exactly
//     like search-jobs. Each company carries its domain, office locations,
//     investors and the ATS it posts from (jobSources).

import { fetchWithUA } from "../lib/http.js";
import { GETRO_TIMEOUT_MS } from "../config.js";
import { clean } from "../lib/html.js";
import { fetchSession, postSearch } from "./consider.js";

const GETRO_API = "https://api.getro.com/api/v2/collections";
const GETRO_PAGE_SIZE = 1000;
const CONSIDER_PAGE_SIZE = 200;
const MAX_PAGES = 10;

// ---------- pure helpers (unit-tested against fixtures) ----------

// "https://www.Ably.com/about" -> "ably.com". Null when there is nothing usable.
export function normaliseDomain(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#]/)[0].replace(/\.$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

function joinLocations(list) {
  const seen = [];
  for (const l of Array.isArray(list) ? list : []) {
    const c = clean(l);
    if (c && !seen.includes(c)) seen.push(c);
  }
  return seen.length ? seen.join("; ") : null;
}

export function parseGetroNetworkId(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    const id = data && data.props && data.props.pageProps && data.props.pageProps.network && data.props.pageProps.network.id;
    return id == null ? null : String(id);
  } catch {
    return null;
  }
}

export function mapGetroCompany(c, host) {
  return {
    name: clean(c.name),
    domain: normaliseDomain(c.domain),
    location: joinLocations(c.locations),
    stage: clean(c.stage), // Getro's own token, e.g. "series_b", "series_unknown"
    jobs_count: Number.isFinite(c.active_jobs_count) ? c.active_jobs_count : null,
    ats: [],
    link: c.slug ? `https://${host}/companies/${c.slug}` : null,
  };
}

export function mapGetroCompanies(json, host) {
  const list = json && json.results && Array.isArray(json.results.companies) ? json.results.companies : [];
  return list.map((c) => mapGetroCompany(c, host));
}

export function mapConsiderCompany(c, origin) {
  const stages = Array.isArray(c.stages) ? c.stages.filter((s) => typeof s === "string" && !/employees/i.test(s)) : [];
  const sources = Array.isArray(c.jobSources) ? c.jobSources.map((s) => s && (s.id || s.value)).filter(Boolean) : [];
  return {
    name: clean(c.name) || clean(c.id),
    domain: normaliseDomain(c.domain) || normaliseDomain(c.website && c.website.url),
    location: joinLocations(c.officeLocations),
    stage: stages.length ? stages.join(", ") : null,
    jobs_count: Number.isFinite(c.numJobs) ? c.numJobs : null,
    ats: sources,
    link: c.slug ? `${origin}/companies/${c.slug}` : null,
  };
}

export function mapConsiderCompanies(json, origin) {
  const list = json && Array.isArray(json.companies) ? json.companies : [];
  return list.map((c) => mapConsiderCompany(c, origin));
}

// ---------- network ----------

async function getroCompanies(host, fetchImpl) {
  const page = await fetchWithUA(`https://${host}/companies`, { headers: { accept: "text/html" }, timeoutMs: GETRO_TIMEOUT_MS }, fetchImpl);
  if (!page.ok) {
    if (page.body) await page.body.cancel();
    throw new Error(`companies page HTTP ${page.status}`);
  }
  const networkId = parseGetroNetworkId(await page.text());
  if (!networkId) throw new Error("network id not found in page (DOM change?)");

  const companies = [];
  let total = null;
  for (let p = 0; p < MAX_PAGES; p++) {
    const res = await fetchWithUA(`${GETRO_API}/${networkId}/search/companies`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", origin: `https://${host}`, referer: `https://${host}/companies` },
      body: JSON.stringify({ hits_per_page: GETRO_PAGE_SIZE, page: p, query: "", filters: "" }),
      timeoutMs: GETRO_TIMEOUT_MS,
    }, fetchImpl);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!res.ok || !json || !json.results) throw new Error(`search HTTP ${res.status}${json ? "" : " non-JSON"}`);
    const batch = mapGetroCompanies(json, host);
    companies.push(...batch);
    total = Number.isFinite(json.results.count) ? json.results.count : total;
    // A short page is the last page, whatever `count` says.
    if (batch.length < GETRO_PAGE_SIZE || total == null || companies.length >= total) break;
  }
  return { companies, total: total == null ? companies.length : total };
}

async function considerCompanies(host, hostedBoard, fetchImpl) {
  const origin = `https://${host}`;
  const session = await fetchSession(origin, hostedBoard, fetchImpl);
  const path = "/api-boards/search-companies";
  const query = { promoteFeatured: true };
  let json = await postSearch(origin, session, { meta: { size: CONSIDER_PAGE_SIZE }, board: session.board, query }, fetchImpl, path);
  let companies = mapConsiderCompanies(json, origin);
  const total = typeof json.total === "number" ? json.total : companies.length;
  let pages = 1;
  while (pages < MAX_PAGES && json.meta && json.meta.sequence && companies.length < total) {
    json = await postSearch(origin, session, { meta: { size: CONSIDER_PAGE_SIZE, sequence: json.meta.sequence }, board: session.board, query }, fetchImpl, path);
    const more = mapConsiderCompanies(json, origin);
    if (!more.length) break;
    companies = companies.concat(more);
    pages += 1;
  }
  return { companies, total };
}

// Returns { companies, counts: { total, fetched }, error }. Never throws for
// board-side failures; the caller's neverThrow catches anything else.
export async function scrapeCompanies({ host, platform, board = null, fetch: fetchImpl = globalThis.fetch }) {
  try {
    const result = platform === "getro"
      ? await getroCompanies(host, fetchImpl)
      : await considerCompanies(host, board, fetchImpl);
    const companies = result.companies.filter((c) => c.name);
    return { companies, counts: { total: result.total, fetched: companies.length }, error: null };
  } catch (err) {
    return { companies: [], counts: { total: 0, fetched: 0 }, error: `${platform}: ${err && err.message ? err.message : String(err)}` };
  }
}
