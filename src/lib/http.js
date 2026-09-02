import { USER_AGENT, FETCH_CONCURRENCY, FETCH_TIMEOUT_MS } from "../config.js";

// fetch with our User-Agent, a per-request timeout and no edge caching.
// `fetchImpl` is injectable so tests can stub the network.
export function fetchWithUA(url, init = {}, fetchImpl = globalThis.fetch) {
  const { timeoutMs, ...rest } = init;
  const headers = { "user-agent": USER_AGENT, ...(rest.headers || {}) };
  const signal = rest.signal || AbortSignal.timeout(timeoutMs || FETCH_TIMEOUT_MS);
  return fetchImpl(url, { cache: "no-store", ...rest, headers, signal });
}

// Map `items` through async `fn`, at most `limit` at a time. Results come back
// in input order as { ok, value } or { ok, error } so one failure does not
// lose the rest.
export async function mapPool(items, fn, limit = FETCH_CONCURRENCY) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err && err.message ? err.message : String(err) };
      }
    }
  }
  const workers = [];
  for (let n = 0; n < Math.min(limit, items.length); n++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
