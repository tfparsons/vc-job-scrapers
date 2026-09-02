import pkg from "../package.json" with { type: "json" };
import { TERMS, LOCATION_KEEP, MAX_AGE_DAYS } from "./config.js";
import { lookupHost } from "./allowlist.js";
import { envelope, jsonResponse, neverThrow } from "./lib/respond.js";
import { scrapeConsider } from "./scrapers/consider.js";
import { scrapeGetro } from "./scrapers/getro.js";

const SCRAPERS = {
  "/consider": { platform: "consider", run: scrapeConsider },
  "/getro": { platform: "getro", run: scrapeGetro },
};

// Debug overrides: ?terms=gtm,growth  ?loc=all  ?days=30. n8n calls with defaults.
function readConfig(params) {
  const rawTerms = (params.get("terms") || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const terms = rawTerms.length ? [...new Set(rawTerms)] : TERMS;

  const locationKeep = params.get("loc") === "all" ? null : LOCATION_KEEP;

  const days = Number.parseInt(params.get("days") || "", 10);
  const maxAgeDays = Number.isInteger(days) && days > 0 ? days : MAX_AGE_DAYS;

  return { terms, location_keep: locationKeep, max_age_days: maxAgeDays };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const now = new Date();

    if (pathname === "/healthz") {
      const meta = env && env.CF_VERSION_METADATA;
      return jsonResponse({
        ok: true,
        version: pkg.version,
        deploy_id: meta && meta.id ? meta.id : null,
      });
    }

    if (pathname === "/") {
      return jsonResponse({
        service: "vc-job-scrapers",
        version: pkg.version,
        endpoints: ["/healthz", "/consider?host=<board host>", "/getro?host=<board host>"],
      });
    }

    const scraper = SCRAPERS[pathname];
    if (!scraper) {
      return jsonResponse({ error: "not found", path: pathname }, { status: 404 });
    }

    const config = readConfig(url.searchParams);
    const rawHost = url.searchParams.get("host");
    const board = lookupHost(rawHost, scraper.platform);
    const base = { source: board ? board.source : null, platform: scraper.platform, now, config };

    if (!board) {
      return jsonResponse(envelope({ ...base, error: `host not allowed: ${rawHost || "(missing)"}` }));
    }

    const body = await neverThrow(base, async () => {
      const result = await scraper.run({ host: board.host, now, config });
      return envelope({ ...base, ...result });
    });
    return jsonResponse(body);
  },
};
