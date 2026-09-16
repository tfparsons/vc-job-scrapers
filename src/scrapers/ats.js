// Per-company ATS poller: /ashby?slug=, /greenhouse?slug=, /lever?slug=,
// /workable?slug=, /teamtailor?host=, /recruitee?slug=. One GET to the ATS's
// public feed, every open role mapped to the contract, then the same terms,
// location and recency filters as the board scrapers. The feeds have no
// search, so the term match is done here on the title: a role is kept when
// any configured term appears in its title as a whole word, and
// `matched_terms` lists the ones that did. `source` is the company name the
// caller passes (n8n has it from the Startup Universe row); default is the
// slug.

import { runFilters } from "../lib/filter.js";
import { fetchWithUA } from "../lib/http.js";
import { FEEDS } from "./ats-feeds.js";

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Terms found in a title, in config order. Whole-word so "crm" does not
// match "Scrum" and "gtm" matches "GTM Engineer".
export function termsInTitle(title, terms) {
  const text = String(title || "").toLowerCase();
  return terms.filter((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t.toLowerCase())}([^a-z0-9]|$)`).test(text));
}

// Workable's widget API answers 429 when the daily poll hits it in a burst.
// Waiting costs no CPU on the Worker, so a 429 gets two slow retries.
const RETRY_429 = [1500, 3000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchFeed(platform, id, fetchImpl) {
  const feed = FEEDS[platform];
  let lastError = null;
  for (const url of feed.urls(id)) {
    let res;
    let text;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetchWithUA(url, { headers: { accept: "application/json, application/rss+xml, text/xml, */*" } }, fetchImpl);
      } catch (err) {
        lastError = err.name === "TimeoutError" ? "timeout" : err.message;
        res = null;
        break;
      }
      text = await res.text();
      if (res.status !== 429 || attempt >= RETRY_429.length) break;
      await sleep(RETRY_429[attempt]);
    }
    if (!res) continue;
    if (res.status === 404) { lastError = "HTTP 404"; continue; } // try the next region
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return feed.map(text);
  }
  throw new Error(lastError || "no feed URL answered");
}

export async function scrapeAts({ platform, id, source, now, config, fetch: fetchImpl = globalThis.fetch }) {
  let all;
  try {
    all = await fetchFeed(platform, id, fetchImpl);
  } catch (err) {
    return { listings: [], counts: null, error: `${platform}: ${err.message}` };
  }

  const named = all.map((l) => ({ ...l, company: l.company || source }));
  const hits = config.terms.map((term) => ({
    term,
    listings: named.filter((l) => termsInTitle(l.title, [term]).length),
  }));
  const { listings, counts } = runFilters(hits, {
    locationRules: config.location_keep ? { keep: config.location_keep, remoteExclude: config.remote_exclude || [] } : null,
    maxAgeDays: config.max_age_days,
    now,
  });
  // `fetched` for a feed is the number of open roles, not term hits.
  return { listings, counts: { ...counts, fetched: named.length }, error: null };
}
