import { contractShape, jsonResponse } from "./lib/normalise.js";

const SCRAPER_ROUTES = new Set(["/getro", "/thriver", "/yc", "/a16z", "/sequoia"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (pathname === "/healthz") {
        return jsonResponse({ ok: true });
      }

      if (SCRAPER_ROUTES.has(pathname)) {
        const source = pathname.slice(1);
        return jsonResponse(
          contractShape({
            source,
            listings: [],
            error: "not implemented yet",
          }),
        );
      }

      if (pathname === "/") {
        return jsonResponse({
          service: "vc-job-scrapers",
          endpoints: ["/healthz", ...[...SCRAPER_ROUTES].sort()],
        });
      }

      return jsonResponse({ error: "not found", path: pathname }, { status: 404 });
    } catch (err) {
      return jsonResponse(
        contractShape({
          source: pathname.replace(/^\//, "") || "unknown",
          listings: [],
          error: `unhandled: ${err && err.message ? err.message : String(err)}`,
        }),
      );
    }
  },
};
