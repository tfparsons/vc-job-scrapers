// Provider config shared by every scraper. Change these, push, done.

export const TERMS = [
  "gtm", "go-to-market", "revops", "revenue operations", "sales operations",
  "marketing operations", "martech", "growth", "lifecycle", "crm", "hubspot",
  "salesforce", "product manager", "forward deployed", "solutions engineer",
];

// A listing is kept when its location names one of these (matched as whole
// words, case-insensitive), or when it is remote and does not name a region
// in LOCATION_REMOTE_EXCLUDE. A missing location is always kept.
export const LOCATION_KEEP = ["london", "united kingdom", "uk", "england", "scotland", "wales", "emea", "europe"];

// "Remote" only counts when it is UK/EU friendly. A remote listing that names
// any of these is dropped, so "Remote - United States" and "US-Remote" go.
export const LOCATION_REMOTE_EXCLUDE = [
  "united states", "usa", "u.s.", "us", "namer", "north america", "americas",
  "canada", "latam", "latin america", "apac", "asia", "australia", "india",
  "singapore", "mexico", "brazil",
  "new york", "san francisco", "chicago", "boston", "austin", "seattle",
  "los angeles", "denver", "atlanta", "miami",
];

export const MAX_AGE_DAYS = 7;

export const USER_AGENT =
  "VC-Job-Scrapers/2.0 (personal job search tool; github.com/tfparsons/vc-job-scrapers)";

// How many board requests run at once per invocation, and how long each may take.
// Getro answers each search in about a second on its own but slows sharply and
// times out when hit in parallel, so its searches run one at a time.
export const FETCH_CONCURRENCY = 4;
export const GETRO_CONCURRENCY = 1;
export const FETCH_TIMEOUT_MS = 15000;
