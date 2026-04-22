export const USER_AGENT = "VC-Job-Scrapers/1.0 (personal job search tool; github.com/tfparsons/vc-job-scrapers)";

export function contractShape({ source, listings = [], error = null, scrapedAt = null }) {
  return {
    source,
    scraped_at: scrapedAt || new Date().toISOString(),
    listings: Array.isArray(listings) ? listings : [],
    error,
  };
}

export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}
