// The output contract. Every scraper endpoint returns HTTP 200 with this shape;
// failures go in `error`, never in the HTTP status.

export function envelope({ source, platform, now, config, listings = [], counts = null, error = null }) {
  return {
    source: source || null,
    platform: platform || null,
    scraped_at: now.toISOString(),
    config: config || null,
    listings: Array.isArray(listings) ? listings : [],
    counts: counts || { fetched: 0, unique: 0, after_location: 0, after_recency: 0 },
    error: error == null ? null : String(error),
  };
}

export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

// Run `fn` and turn any thrown error into an envelope with `error` set.
export async function neverThrow(base, fn) {
  try {
    return await fn();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return envelope({ ...base, listings: [], error: `unhandled: ${message}` });
  }
}
