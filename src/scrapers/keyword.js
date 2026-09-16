// Keyword source endpoints (Session E). Each takes ?q=<phrase>, the title n8n
// reads from the Keyword Sources row's Keywords column, one call per line:
//   /adzuna?q=          Adzuna UK search, what_phrase + where=London (key: ADZUNA_APP_ID / ADZUNA_APP_KEY)
//   /reed?q=            Reed search, London 15 miles, direct employers (key: REED_API_KEY)
//   /workable-search?q= Jobs by Workable cross-company search, quoted phrase, London, up to 3 pages
//   /rss?feed=revopscareers&q=  RevOps Careers job feed, United Kingdom + keyword
//   /rss?feed=clay      Clay community share-jobs RSS (no query; titles filtered on the config terms)
// A listing is kept when its title contains the phrase or any config term as
// a whole word; then the shared location and recency filters run.

import { runFilters } from "../lib/filter.js";
import { fetchWithUA } from "../lib/http.js";
import { termsInTitle } from "./ats.js";
import { mapAdzuna, mapReed, mapWorkableSearch, mapRevopsCareers, mapClayCommunity } from "./keyword-feeds.js";

const PHRASE = /^[\p{L}\p{N} .&+/-]{2,60}$/u;
export const validPhrase = (q) => (typeof q === "string" && PHRASE.test(q.trim()) ? q.trim() : null);

const WORKABLE_PAGES = 3;
export const RSS_FEEDS = ["revopscareers", "clay"];

async function getText(url, init, fetchImpl) {
  const res = await fetchWithUA(url, init, fetchImpl);
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status} (check the API key secret)`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return text;
}

export const KEYWORD = {
  adzuna: {
    needsQuery: true,
    secrets: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"],
    async fetch({ q, env, config, fetchImpl }) {
      const u = new URL("https://api.adzuna.com/v1/api/jobs/gb/search/1");
      u.searchParams.set("app_id", env.ADZUNA_APP_ID);
      u.searchParams.set("app_key", env.ADZUNA_APP_KEY);
      u.searchParams.set("what_phrase", q);
      u.searchParams.set("where", "London");
      u.searchParams.set("max_days_old", String(config.max_age_days));
      u.searchParams.set("sort_by", "date");
      u.searchParams.set("results_per_page", "50");
      u.searchParams.set("content-type", "application/json");
      return mapAdzuna(await getText(u.toString(), { headers: { accept: "application/json" } }, fetchImpl));
    },
  },
  reed: {
    needsQuery: true,
    secrets: ["REED_API_KEY"],
    async fetch({ q, env, fetchImpl }) {
      const u = new URL("https://www.reed.co.uk/api/1.0/search");
      u.searchParams.set("keywords", q);
      u.searchParams.set("locationName", "London");
      u.searchParams.set("distanceFromLocation", "15");
      u.searchParams.set("postedByDirectEmployer", "true");
      u.searchParams.set("resultsToTake", "100");
      const auth = `Basic ${btoa(`${env.REED_API_KEY}:`)}`;
      return mapReed(await getText(u.toString(), { headers: { accept: "application/json", authorization: auth } }, fetchImpl));
    },
  },
  "workable-search": {
    needsQuery: true,
    secrets: [],
    async fetch({ q, fetchImpl }) {
      const out = [];
      let token = null;
      for (let page = 0; page < WORKABLE_PAGES; page++) {
        const u = new URL("https://jobs.workable.com/api/v1/jobs");
        u.searchParams.set("query", `"${q}"`);
        u.searchParams.set("location", "London");
        if (token) u.searchParams.set("pageToken", token);
        const { listings, next } = mapWorkableSearch(await getText(u.toString(), { headers: { accept: "application/json" } }, fetchImpl));
        out.push(...listings);
        if (!next || !listings.length) break;
        token = next;
      }
      return out;
    },
  },
  rss: {
    needsQuery: false,
    secrets: [],
    async fetch({ q, feed, fetchImpl }) {
      if (feed === "revopscareers") {
        const u = new URL("https://revopscareers.com/");
        u.searchParams.set("feed", "job_feed");
        u.searchParams.set("search_location", "United Kingdom");
        if (q) u.searchParams.set("search_keywords", q);
        return mapRevopsCareers(await getText(u.toString(), {}, fetchImpl));
      }
      return mapClayCommunity(await getText("https://community.clay.com/x/share-jobs/rss.xml", {}, fetchImpl));
    },
  },
};

export async function scrapeKeyword({ name, q, feed, env = {}, now, config, fetch: fetchImpl = globalThis.fetch }) {
  const def = KEYWORD[name];
  const missing = def.secrets.filter((s) => !env[s]);
  if (missing.length) return { listings: [], counts: null, error: `${name}: secret not set: ${missing.join(", ")}` };

  let all;
  try {
    all = await def.fetch({ q, feed, env, config, fetchImpl });
  } catch (err) {
    return { listings: [], counts: null, error: `${name}: ${err.name === "TimeoutError" ? "timeout" : err.message}` };
  }

  const terms = [...new Set([...(q ? [q.toLowerCase()] : []), ...config.terms])];
  const hits = terms.map((term) => ({ term, listings: all.filter((l) => termsInTitle(l.title, [term]).length) }));
  const { listings, counts } = runFilters(hits, {
    locationRules: config.location_keep ? { keep: config.location_keep, remoteExclude: config.remote_exclude || [] } : null,
    maxAgeDays: config.max_age_days,
    now,
  });
  return { listings, counts: { ...counts, fetched: all.length }, error: null };
}
