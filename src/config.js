// Provider config shared by every scraper. Change these, push, done.

export const TERMS = [
  "gtm", "go-to-market", "revops", "revenue operations", "sales operations",
  "marketing operations", "martech", "growth", "lifecycle", "crm", "hubspot",
  "salesforce", "product manager", "forward deployed", "solutions engineer",
];

export const LOCATION_KEEP = ["london", "united kingdom", "uk", "remote", "emea", "europe"];

export const MAX_AGE_DAYS = 7;

export const USER_AGENT =
  "VC-Job-Scrapers/2.0 (personal job search tool; github.com/tfparsons/vc-job-scrapers)";

// How many board requests run at once per invocation, and how long each may take.
export const FETCH_CONCURRENCY = 4;
export const FETCH_TIMEOUT_MS = 15000; // Getro searches can take 5-8 s under load
