// a16z portfolio jobs (jobs.a16z.com): a Next.js site that server-renders the
// first 25 matching cards as <article> elements. ?q=<term> filters by keyword
// and ?posted=<days> limits to recently posted roles, so one GET per term with
// posted=max_age_days covers the window. Cards link straight to the company's
// ATS. Validated live 3 Sep 2026.

import { runFilters } from "../lib/filter.js";
import { fetchWithUA, mapPool } from "../lib/http.js";
import { clean, stripTags } from "../lib/html.js";

export const A16Z_HOST = "jobs.a16z.com";
const CONCURRENCY = 2;
const TRACKING_PARAMS = /^(utm_|lever-source|gh_src)/i;
const MONEY = /^(?:USD|GBP|EUR|CAD|AUD|CHF|SEK|[$£€])\s?[\d,.]+/i;

// Drop tracking parameters the board appends so the link is stable run to run.
export function cleanLink(href) {
  try {
    const u = new URL(href);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    return u.toString().replace(/\?$/, "");
  } catch {
    return href || null;
  }
}

function first(re, text) {
  const m = text.match(re);
  return m ? m[1] : null;
}

export function parseA16zCard(chunk) {
  const company = clean(first(/href="\/jobs\/[^"]+"[^>]*>([^<]+)<\/a>/, chunk));
  const titleMatch = chunk.match(/<h2[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/);
  const link = titleMatch ? cleanLink(titleMatch[1]) : null;
  const title = titleMatch ? clean(titleMatch[2]) : null;

  const timeMatch = chunk.match(/<time[^>]*dateTime="([^"]+)"[^>]*>([^<]*)<\/time>/i);
  const rawDate = timeMatch ? timeMatch[1] : null;
  const postedDate = rawDate ? first(/^(\d{4}-\d{2}-\d{2})/, rawDate) : null;
  const postedRelative = timeMatch ? clean(timeMatch[2].replace(/^Posted\s+/i, "")) : null;

  // The line under the title reads "USD 125,000-155,000 / Year · New York, NY, US · Posted 10 hours ago".
  const afterTitle = chunk.split("</h2>")[1] || "";
  const metaHtml = afterTitle.split("<time")[0];
  const parts = stripTags(metaHtml.replace(/<svg[\s\S]*?<\/svg>/g, " "))
    .split("·")
    .map((p) => p.trim())
    .filter(Boolean);
  const salary = parts.find((p) => MONEY.test(p)) || null;
  const location = parts.filter((p) => p !== salary && !/^Posted\b/i.test(p)).join("; ") || null;

  return {
    company,
    title,
    location,
    posted_date: postedDate,
    posted_relative: postedRelative,
    seniority: null,
    salary_raw: salary,
    remote: null,
    link,
  };
}

export function parseA16zPage(html) {
  const chunks = String(html).split("<article").slice(1);
  return chunks.map(parseA16zCard).filter((c) => c.link && c.title);
}

async function fetchTerm(term, days, fetchImpl) {
  const url = `https://${A16Z_HOST}/jobs?q=${encodeURIComponent(term)}&posted=${days}`;
  const res = await fetchWithUA(url, { headers: { accept: "text/html" } }, fetchImpl);
  if (!res.ok) {
    if (res.body) await res.body.cancel();
    throw new Error(`HTTP ${res.status} for ${term}`);
  }
  return parseA16zPage(await res.text());
}

export async function scrapeA16z({ now, config, fetch: fetchImpl = globalThis.fetch }) {
  const days = config.max_age_days;
  const results = await mapPool(config.terms, (term) => fetchTerm(term, days, fetchImpl), CONCURRENCY);

  const hits = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.ok) hits.push({ term: config.terms[i], listings: r.value });
    else failures.push(r.error);
  });

  if (hits.length === 0) {
    return { listings: [], counts: null, error: `a16z: ${failures[0] || "no results"}` };
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
