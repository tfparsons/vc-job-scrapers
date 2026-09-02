// Filter semantics shared by every scraper. Order: dedupe on link, then
// location, then recency. Empty is safe, wrong is dangerous: a listing with no
// location or no date is kept, because dropping it silently is how good roles
// go missing.

import { isStaleRelative } from "./relative-date.js";

// `hits` is [{ term, listings }] in config order. Union on `link`, recording
// every term that returned each listing.
export function unionByLink(hits) {
  const byLink = new Map();
  let fetched = 0;
  for (const { term, listings } of hits) {
    for (const listing of listings || []) {
      fetched += 1;
      if (!listing || !listing.link) continue;
      const existing = byLink.get(listing.link);
      if (existing) {
        if (!existing.matched_terms.includes(term)) existing.matched_terms.push(term);
      } else {
        byLink.set(listing.link, { ...listing, matched_terms: [term] });
      }
    }
  }
  return { listings: [...byLink.values()], fetched };
}

export function keepByLocation(listing, locationKeep) {
  if (!locationKeep) return true; // ?loc=all
  if (listing.remote === true) return true;
  const loc = listing.location;
  if (loc == null || String(loc).trim() === "") return true;
  const lower = String(loc).toLowerCase();
  return locationKeep.some((token) => lower.includes(token));
}

export function keepByRecency(listing, maxAgeDays, now) {
  if (!listing.posted_date) {
    // No parseable date. Keep, unless the board itself says it is a month or more old.
    return !isStaleRelative(listing.posted_relative);
  }
  const posted = Date.parse(`${listing.posted_date}T00:00:00Z`);
  if (!Number.isFinite(posted)) return true;
  // Compare calendar days, not clock time, so "7 days" means 7 days inclusive.
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const ageDays = Math.floor((today - posted) / 86400e3);
  return ageDays <= maxAgeDays;
}

export function runFilters(hits, { locationKeep, maxAgeDays, now }) {
  const { listings: unique, fetched } = unionByLink(hits);
  const afterLocation = unique.filter((l) => keepByLocation(l, locationKeep));
  const afterRecency = afterLocation.filter((l) => keepByRecency(l, maxAgeDays, now));
  return {
    listings: afterRecency,
    counts: {
      fetched,
      unique: unique.length,
      after_location: afterLocation.length,
      after_recency: afterRecency.length,
    },
  };
}
