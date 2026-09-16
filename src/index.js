import pkg from "../package.json" with { type: "json" };
import { TERMS, LOCATION_KEEP, LOCATION_REMOTE_EXCLUDE, MAX_AGE_DAYS } from "./config.js";
import { lookupHost, lookupBoardHost, lookupTeamtailorHost, defaultHostFor } from "./allowlist.js";
import { scrapeAts } from "./scrapers/ats.js";
import { FEEDS, validSlug } from "./scrapers/ats-feeds.js";
import { envelope, jsonResponse, neverThrow } from "./lib/respond.js";
import { scrapeConsider } from "./scrapers/consider.js";
import { scrapeGetro } from "./scrapers/getro.js";
import { scrapeYc } from "./scrapers/yc.js";
import { scrapeA16z } from "./scrapers/a16z.js";
import { scrapeCompanies } from "./scrapers/companies.js";

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

// Boards hosted on the platform's own domain need ?board=<id> to say which one.
// Returns the board id, or null when it is missing or malformed.
function readHostedBoard(params) {
  const raw = (params.get("board") || "").trim().toLowerCase();
  return /^[a-z0-9-]{1,80}$/.test(raw) ? raw : null;
}

// /companies?host=<board>: a different contract from the job scrapers, so it
// has its own envelope: { source, platform, scraped_at, companies, counts, error }.
async function handleCompanies(url, now) {
  const rawHost = url.searchParams.get("host");
  const board = lookupBoardHost(rawHost);
  const base = { source: board ? board.source : null, platform: board ? board.platform : null, scraped_at: now.toISOString() };
  const fail = (error) => jsonResponse({ ...base, companies: [], counts: { total: 0, fetched: 0 }, error });
  if (!board) return fail(`host not allowed: ${rawHost || "(missing)"}`);

  let hostedBoard = null;
  if (board.hosted) {
    hostedBoard = readHostedBoard(url.searchParams);
    if (!hostedBoard) return fail(`board required for ${board.host}: ?board=<id>`);
    base.source = hostedBoard;
  }

  try {
    const result = await scrapeCompanies({ host: board.host, platform: board.platform, board: hostedBoard });
    return jsonResponse({ ...base, ...result });
  } catch (err) {
    return fail(`unhandled: ${err && err.message ? err.message : String(err)}`);
  }
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
        endpoints: ["/healthz", "/consider?host=<board host>", "/consider?host=consider.com&board=<id>", "/getro?host=<board host>", "/yc", "/a16z", "/companies?host=<board host>", "/ashby?slug=", "/greenhouse?slug=", "/lever?slug=", "/workable?slug=", "/teamtailor?host=", "/recruitee?slug="],
      });
    }

    if (pathname === "/companies") return handleCompanies(url, now);

    // Per-company ATS feeds: /ashby?slug=x, /teamtailor?host=x, ... with an
    // optional &source=<company name> for the envelope.
    const atsPlatform = pathname.slice(1);
    if (FEEDS[atsPlatform]) {
      const config = readConfig(url.searchParams);
      const key = FEEDS[atsPlatform].key;
      const raw = url.searchParams.get(key);
      const id = key === "host" ? lookupTeamtailorHost(raw) : validSlug(raw);
      const source = (url.searchParams.get("source") || "").trim().slice(0, 120) || id;
      const base = { source, platform: atsPlatform, now, config };
      if (!id) {
        const why = key === "host" ? `host not allowed: ${raw || "(missing)"}` : `${key} required: ?${key}=<${atsPlatform} board id>`;
        return jsonResponse(envelope({ ...base, error: why }));
      }
      const body = await neverThrow(base, async () => envelope({ ...base, ...(await scrapeAts({ platform: atsPlatform, id, source, now, config })) }));
      return jsonResponse(body);
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

    let hostedBoard = null;
    if (board.hosted) {
      hostedBoard = readHostedBoard(url.searchParams);
      if (!hostedBoard) {
        return jsonResponse(envelope({ ...base, error: `board required for ${board.host}: ?board=<id>` }));
      }
      base.source = hostedBoard;
    }

    const body = await neverThrow(base, async () => {
      const result = await scraper.run({ host: board.host, board: hostedBoard, now, config });
      return envelope({ ...base, ...result });
    });
    return jsonResponse(body);
  },
};
