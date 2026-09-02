// Getro boards (talent.seedcamp.com and friends). Server-rendered HTML with
// schema.org JobPosting microdata, up to 20 cards per response. One GET per
// term: https://{host}/jobs?q={term}. The term loop is the coverage mechanism;
// we do not chase the infinite scroll. Patterns validated live 2 Sep 2026.

import { runFilters } from "../lib/filter.js";
import { fetchWithUA, mapPool } from "../lib/http.js";
import { GETRO_CONCURRENCY, GETRO_TIMEOUT_MS } from "../config.js";
import { clean, stripTags } from "../lib/html.js";
import { relativeToDate } from "../lib/relative-date.js";

const CARD_MARKER = 'data-testid="job-list-item"';

// Checked in order; "Mid-Senior Level" must come before "Senior".
const SENIORITY = ["Mid-Senior Level", "Entry Level", "Internship", "Associate", "Senior", "Director", "Executive"];

// ---------- pure parsing (unit-tested against fixtures) ----------

function first(re, text) {
  const m = text.match(re);
  return m ? m[1] : null;
}

export function parseGetroCard(chunk, host, now) {
  const company = clean(first(/itemprop="name"\s+content="([^"]*)"/i, chunk));
  const description = clean(first(/itemprop="description"\s+content="([^"]*)"/i, chunk));

  let title = clean(first(/job-title-text"[^>]*>\s*(?:<span[^>]*>\s*)?([^<]+)/, chunk));
  if (!title && description && company) {
    const suffix = ` at ${company}`;
    title = description.endsWith(suffix) ? description.slice(0, -suffix.length) : description;
  }

  const href = first(/href="(\/companies\/[^"]+\/jobs\/[^"#]+)/, chunk);

  // Visible text of the card, up to its "View job" button, e.g.
  // "GTM Engineer Ably Location: London, UK ; Remote Posted: 9 days Series B Mid-Senior Level ..."
  let flat = stripTags(chunk);
  const cut = flat.indexOf("View job");
  if (cut > 0) flat = flat.slice(0, cut);

  const postedRelative = first(/Posted:\s*((?:\d+|an?)\s+(?:minute|hour|day|week|month|year)s?(?:\s+ago)?)/i, flat);
  const salaryRaw = clean(first(/Compensation:\s*(.+?)\s*(?:Posted:|Location:|$)/i, flat));

  // The board displays every location ("London, UK; Remote") but only puts the
  // first one in the microdata, so prefer the visible text.
  const visibleLocation = first(/Location:\s*(.+?)\s*(?:Compensation:|Posted:|$)/i, flat);
  let locations = visibleLocation
    ? visibleLocation.split(";").map((l) => clean(l)).filter(Boolean)
    : [];
  if (!locations.length) {
    locations = [...chunk.matchAll(/itemprop="addressLocality"\s+content="([^"]*)"/gi)]
      .map((m) => clean(m[1]))
      .filter(Boolean);
  }

  const afterPosted = postedRelative ? flat.slice(flat.indexOf(postedRelative) + postedRelative.length) : flat;
  const seniority = SENIORITY.find((s) => new RegExp(`(^|\\s)${s}(\\s|$)`).test(afterPosted)) || null;

  const rawDate = first(/itemprop="dateposted"\s+content="([^"]*)"/i, chunk);
  const isoFromMeta = rawDate ? first(/^(\d{4}-\d{2}-\d{2})/, rawDate) : null;
  const postedDate = isoFromMeta || relativeToDate(postedRelative, now);

  return {
    company,
    title,
    location: locations.length ? locations.join("; ") : null,
    posted_date: postedDate,
    posted_relative: postedRelative,
    seniority,
    salary_raw: salaryRaw,
    remote: null,
    link: href ? `https://${host}${href}` : null,
  };
}

export function parseGetroPage(html, host, now) {
  const text = String(html);
  const poweredByGetro = /powered by getro/i.test(text);
  const cards = text.split(CARD_MARKER).slice(1).map((chunk) => parseGetroCard(chunk, host, now));
  return { cards, poweredByGetro };
}

// ---------- network ----------

async function fetchTermOnce(host, term, now, fetchImpl) {
  const url = `https://${host}/jobs?q=${encodeURIComponent(term)}`;
  const res = await fetchWithUA(url, { headers: { accept: "text/html" }, timeoutMs: GETRO_TIMEOUT_MS }, fetchImpl);
  if (!res.ok) {
    if (res.body) await res.body.cancel();
    throw new Error(`HTTP ${res.status} for ${term}`);
  }
  return parseGetroPage(await res.text(), host, now);
}

// Getro occasionally stalls on a single search. One retry after a timeout is
// enough; anything else fails the term and is reported as partial.
async function fetchTerm(host, term, now, fetchImpl) {
  try {
    return await fetchTermOnce(host, term, now, fetchImpl);
  } catch (err) {
    if (err && (err.name === "TimeoutError" || /timeout|aborted/i.test(err.message || ""))) {
      return fetchTermOnce(host, term, now, fetchImpl);
    }
    throw err;
  }
}

export async function scrapeGetro({ host, now, config, fetch: fetchImpl = globalThis.fetch }) {
  const results = await mapPool(config.terms, (term) => fetchTerm(host, term, now, fetchImpl), GETRO_CONCURRENCY);

  const hits = [];
  const failures = [];
  let poweredByGetro = false;
  results.forEach((r, i) => {
    if (r.ok) {
      hits.push({ term: config.terms[i], listings: r.value.cards });
      if (r.value.poweredByGetro) poweredByGetro = true;
    } else {
      failures.push(r.error);
    }
  });

  if (hits.length === 0) {
    return { listings: [], counts: null, error: `getro: ${failures[0] || "no results"}` };
  }
  if (poweredByGetro && hits.every((h) => h.listings.length === 0)) {
    return { listings: [], counts: null, error: "getro: 0 cards on all terms (DOM change?)" };
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
