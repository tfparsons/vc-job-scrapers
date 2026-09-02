// Consider.com boards (jobs.notion.vc and friends). The HTML has no listings;
// a search API sits behind a CSRF token printed in the page. Two steps:
//   1. GET https://{host}/jobs   -> cookies + csrfToken + board id
//   2. POST https://{host}/api-boards/search-jobs, once per term
// Parsing patterns were validated live on 2 Sep 2026 (see BRIEF.md), with one
// correction: the search key is `titlePrefix` (what the site's own "Search by
// title" box sends), not `query`, which the API silently ignores. It matches
// word prefixes in the job title, so "growth" finds "Product Growth Manager".

import { runFilters, keepByRecency } from "../lib/filter.js";
import { fetchWithUA, mapPool } from "../lib/http.js";
import { parseSetCookies, cookieHeaderFrom, setCookiesFromResponse } from "../lib/cookies.js";
import { clean } from "../lib/html.js";

const PAGE_SIZE = 100; // newest-first; one page usually covers weeks
const MAX_PAGES = 3; // only paged while the last job on a page is still recent

// ---------- pure parsing (unit-tested against fixtures) ----------

export function parseConsiderSession(html) {
  const token = String(html).match(/"csrfToken":"([^"]+)"/);
  const board = String(html).match(/"board":(\{"id":"[^"]+","isParent":(?:true|false)\})/);
  let boardObj = null;
  if (board) {
    try { boardObj = JSON.parse(board[1]); } catch { boardObj = null; }
  }
  return { csrfToken: token ? token[1] : null, board: boardObj };
}

function isoDate(ts) {
  if (typeof ts === "string") {
    const m = ts.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return new Date(ts).toISOString().slice(0, 10);
  }
  return null;
}

export function mapConsiderJob(job) {
  const locations = Array.isArray(job.locations)
    ? job.locations.filter((l) => typeof l === "string" && l.trim()).map((l) => l.trim())
    : [];
  const seniorities = Array.isArray(job.jobSeniorities)
    ? job.jobSeniorities.map((s) => (typeof s === "string" ? s : s && s.label)).filter(Boolean)
    : [];
  return {
    company: clean(job.companyName),
    title: clean(job.title),
    location: locations.length ? locations.join("; ") : null,
    posted_date: isoDate(job.timeStamp),
    posted_relative: null,
    seniority: seniorities.length ? seniorities.join(", ") : null,
    // Consider's `salary` object is frequently an estimate (isOriginal: false).
    // Never build a string from it; downstream hard-excludes on bad salaries.
    salary_raw: null,
    remote: typeof job.remote === "boolean" ? job.remote : null,
    // `url` is the canonical ATS link. `applyUrl` carries a utm suffix; never use it.
    link: typeof job.url === "string" && job.url ? job.url : null,
  };
}

export function mapConsiderJobs(json) {
  const jobs = json && Array.isArray(json.jobs) ? json.jobs : [];
  return jobs.map(mapConsiderJob);
}

// ---------- network ----------

async function fetchSession(origin, fetchImpl) {
  let res = await fetchWithUA(`${origin}/jobs`, { redirect: "manual" }, fetchImpl);
  const jar = parseSetCookies(setCookiesFromResponse(res));
  if (res.status >= 300 && res.status < 400) {
    // Follow one redirect by hand so its cookies are not lost.
    const location = res.headers.get("location");
    if (!location) throw new Error(`board page redirected without a location (HTTP ${res.status})`);
    if (res.body) await res.body.cancel();
    res = await fetchWithUA(new URL(location, origin).toString(), { headers: { cookie: cookieHeaderFrom(jar) } }, fetchImpl);
    parseSetCookies(setCookiesFromResponse(res), jar);
  }
  if (!res.ok) {
    if (res.body) await res.body.cancel();
    throw new Error(`board page HTTP ${res.status}`);
  }
  const html = await res.text();
  const { csrfToken, board } = parseConsiderSession(html);
  if (!csrfToken || !board) throw new Error("csrf token or board id not found in page");
  return { csrfToken, board, cookie: cookieHeaderFrom(jar) };
}

async function postSearch(origin, session, body, fetchImpl) {
  const res = await fetchWithUA(`${origin}/api-boards/search-jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": session.csrfToken,
      origin,
      referer: `${origin}/jobs`,
      cookie: session.cookie,
    },
    body: JSON.stringify(body),
  }, fetchImpl);

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }

  if (res.status === 412) throw new Error(`412 ${(json && json.error) || "INVALID_CSRF"}`);
  if (json === null) throw new Error(`non-JSON response (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(json && json.error) || ""}`.trim());
  return json;
}

// One term: first page, then further pages only while the board says there is
// more AND the oldest job we have is still inside the recency window.
async function searchTerm(origin, session, term, { now, maxAgeDays }, fetchImpl) {
  const query = { promoteFeatured: true, titlePrefix: term };
  let json = await postSearch(origin, session, { meta: { size: PAGE_SIZE }, board: session.board, query }, fetchImpl);
  let listings = mapConsiderJobs(json);
  let pages = 1;
  while (
    pages < MAX_PAGES &&
    json.meta && json.meta.sequence &&
    typeof json.total === "number" && json.total > listings.length &&
    listings.length > 0 &&
    keepByRecency(listings[listings.length - 1], maxAgeDays, now)
  ) {
    json = await postSearch(origin, session, { meta: { size: PAGE_SIZE, sequence: json.meta.sequence }, board: session.board, query }, fetchImpl);
    const more = mapConsiderJobs(json);
    if (!more.length) break;
    listings = listings.concat(more);
    pages += 1;
  }
  return listings;
}

export async function scrapeConsider({ host, now, config, fetch: fetchImpl = globalThis.fetch }) {
  const origin = `https://${host}`;
  let session;
  try {
    session = await fetchSession(origin, fetchImpl);
  } catch (err) {
    return { listings: [], counts: null, error: `consider: ${err.message}` };
  }

  const window = { now, maxAgeDays: config.max_age_days };
  const results = await mapPool(config.terms, (term) => searchTerm(origin, session, term, window, fetchImpl));

  const hits = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.ok) hits.push({ term: config.terms[i], listings: r.value });
    else failures.push(r.error);
  });

  if (hits.length === 0) {
    return { listings: [], counts: null, error: `consider: ${failures[0] || "no results"}` };
  }

  const { listings, counts } = runFilters(hits, {
    locationRules: config.location_keep ? { keep: config.location_keep, remoteExclude: config.remote_exclude || [] } : null,
    maxAgeDays: config.max_age_days,
    now,
  });
  const error = failures.length
    ? `partial: ${failures.length}/${config.terms.length} term fetches failed: ${failures[0]}`
    : null;
  return { listings, counts, error };
}
