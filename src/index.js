import pkg from "../package.json" with { type: "json" };
import { TERMS, LOCATION_KEEP, LOCATION_REMOTE_EXCLUDE, MAX_AGE_DAYS } from "./config.js";
import { lookupHost, defaultHostFor } from "./allowlist.js";
import { envelope, jsonResponse, neverThrow } from "./lib/respond.js";
import { scrapeConsider } from "./scrapers/consider.js";
import { scrapeGetro } from "./scrapers/getro.js";
import { scrapeYc } from "./scrapers/yc.js";
import { scrapeA16z } from "./scrapers/a16z.js";

const SCRAPERS = {
  "/consider": { platform: "consider", run: scrapeConsider },
  "/getro": { platform: "getro", run: scrapeGetro },
  "/yc": { platform: "yc", run: scrapeYc },
  "/a16z": { platform: "a16z", run: scrapeA16z },
};

// Debug overrides: ?terms=gtm,growth  ?loc=all  ?days=30. n8n calls with defaults.
function readConfig(params) {
  const rawTerms = (params.get("terms") || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const terms = rawTerms.length ? [...new Set(rawTerms)] : TERMS;

  const all = params.get("loc") === "all";
  const locationKeep = all ? null : LOCATION_KEEP;
  const remoteExclude = all ? null : LOCATION_REMOTE_EXCLUDE;

  const days = Number.parseInt(params.get("days") || "", 10);
  const maxAgeDays = Number.isInteger(days) && days > 0 ? days : MAX_AGE_DAYS;

  return { terms, location_keep: locationKeep, remote_exclude: remoteExclude, max_age_days: maxAgeDays };
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
        endpoints: ["/healthz", "/consider?host=<board host>", "/consider?host=consider.com&board=<id>", "/getro?host=<board host>", "/yc", "/a16z"],
      });
    }

    const scraper = SCRAPERS[pathname];
    if (!scraper) {
      return jsonResponse({ error: "not found", path: pathname }, { status: 404 });
    }

    const config = readConfig(url.searchParams);
    const rawHost = url.searchParams.get("host") || defaultHostFor(scraper.platform);
    const board = lookupHost(rawHost, scraper.platform);
    const base = { source: board ? board.source : null, platform: scraper.platform, now, config };

    if (!board) {
      return jsonResponse(envelope({ ...base, error: `host not allowed: ${rawHost || "(missing)"}` }));
    }

    // Boards hosted on the platform's own domain need ?board=<id> to say which one.
    let hostedBoard = null;
    if (board.hosted) {
      const rawBoard = (url.searchParams.get("board") || "").trim().toLowerCase();
      if (!/^[a-z0-9-]{1,80}$/.test(rawBoard)) {
        return jsonResponse(envelope({ ...base, error: `board required for ${board.host}: ?board=<id>` }));
      }
      hostedBoard = rawBoard;
      base.source = rawBoard;
    }

    const body = await neverThrow(base, async () => {
      const result = await scraper.run({ host: board.host, board: hostedBoard, now, config });
      return envelope({ ...base, ...result });
    });
    return jsonResponse(body);
  },
};
