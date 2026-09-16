// Host allowlist. The Worker only ever fetches these hosts, so it cannot be
// pointed at arbitrary sites. To add a Consider or Getro board, add one line
// here (and a Sources row in Airtable); nothing else changes.

export const HOSTS = {
  // Consider.com boards (client-rendered; search API behind a CSRF token)
  "jobs.notion.vc": { platform: "consider", source: "notion" },
  "careers.balderton.com": { platform: "consider", source: "balderton" },
  "jobs.phoenixcourt.vc": { platform: "consider", source: "phoenixcourt" },
  "jobs.hoxtonventures.com": { platform: "consider", source: "hoxton" },
  "jobs.anthemis.com": { platform: "consider", source: "anthemis" },
  "jobs.amadeuscapital.com": { platform: "consider", source: "amadeus" },
  "careers.highlandeurope.com": { platform: "consider", source: "highlandeurope" },
  "jobs.sequoiacap.com": { platform: "consider", source: "sequoia" },

  // Getro boards (server-rendered; schema.org JobPosting microdata)
  "jobs.dawncapital.com": { platform: "getro", source: "dawn" },
  "indexventures.getro.com": { platform: "getro", source: "index" },
  "talent.seedcamp.com": { platform: "getro", source: "seedcamp" },
  "jobs.mmc.vc": { platform: "getro", source: "mmc" },
  "talent.octopusventures.com": { platform: "getro", source: "octopus" },
  "opportunities.northzone.com": { platform: "getro", source: "northzone" },
  "jobs.accel.com": { platform: "getro", source: "accel" },
  "careers.atomico.com": { platform: "getro", source: "atomico" },
  "portfolio.joinef.com": { platform: "getro", source: "ef" },

  // Tier 1 adds, 3 Sep 2026 (coverage audit). All verified live that day.
  "jobs.generalcatalyst.com": { platform: "getro", source: "generalcatalyst" },
  "portfoliojobs.partechpartners.com": { platform: "getro", source: "partech" },
  "talent.cherry.vc": { platform: "getro", source: "cherry" },
  "positions.moonfire.com": { platform: "getro", source: "moonfire" },
  "jobs.hvcapital.com": { platform: "getro", source: "hvcapital" },
  "jobs.headline.com": { platform: "getro", source: "headline" },
  "careers.crane.vc": { platform: "getro", source: "crane" },
  "jobs.pointnine.com": { platform: "getro", source: "pointnine" },
  "jobs.firstminute.capital": { platform: "getro", source: "firstminute" },
  "talent.backed.vc": { platform: "getro", source: "backed" },
  "jobs.outlierventures.io": { platform: "getro", source: "outlier" },
  "careers.speedinvest.com": { platform: "getro", source: "speedinvest" },
  "jobs.techstars.com": { platform: "getro", source: "techstars" },
  "jobs.lsvp.com": { platform: "consider", source: "lightspeed" },
  // Creandum moved from Consider to Getro (found 16 Sep 2026 when its Consider session stopped parsing).
  "careers.creandum.com": { platform: "getro", source: "creandum" },
  "careers.playfair.vc": { platform: "consider", source: "playfair" },
  "jobs.gtmfund.com": { platform: "consider", source: "gtmfund" },

  // Boards hosted on consider.com itself (no vanity domain). The board id comes
  // from ?board=<id>; the source slug becomes that id. Point72 = point72-ventures.
  "consider.com": { platform: "consider", source: "consider-hosted", hosted: true },

  // Single-host platforms with their own scraper module.
  "www.workatastartup.com": { platform: "yc", source: "ycombinator" },
  "jobs.a16z.com": { platform: "a16z", source: "a16z" },
};

// Teamtailor careers sites on a company's own host. Any *.teamtailor.com host
// is accepted without listing; a custom host must be here, since the
// endpoint fetches https://{host}/jobs.rss and the allowlist is the abuse
// guard. Slugs for the other ATS endpoints need no allowlist: they are only
// ever inserted into the ATS's own API URL.
export const TEAMTAILOR_HOSTS = [
  "career.spendesk.com",
  "careers.sanogenetics.com",
  "careers.screencloud.com",
  "fishbrain.com",
];

export function lookupTeamtailorHost(raw) {
  if (!raw || typeof raw !== "string") return null;
  const host = raw.trim().toLowerCase();
  if (!HOST_SHAPE.test(host)) return null;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.teamtailor\.com$/.test(host) || TEAMTAILOR_HOSTS.includes(host)) return host;
  return null;
}

const HOST_SHAPE = /^[a-z0-9.-]+$/;

// Returns { host, platform, source } or null. `host` is normalised to lowercase.
export function lookupHost(raw, platform) {
  if (!raw || typeof raw !== "string") return null;
  const host = raw.trim().toLowerCase();
  if (!HOST_SHAPE.test(host)) return null;
  const entry = HOSTS[host];
  if (!entry || entry.platform !== platform) return null;
  return { host, ...entry };
}

// For /companies, which serves both board platforms: any Consider or Getro
// host on the allowlist, with its platform. Null otherwise.
export function lookupBoardHost(raw) {
  if (!raw || typeof raw !== "string") return null;
  const host = raw.trim().toLowerCase();
  if (!HOST_SHAPE.test(host)) return null;
  const entry = HOSTS[host];
  if (!entry || (entry.platform !== "consider" && entry.platform !== "getro")) return null;
  return { host, ...entry };
}

export function hostsFor(platform) {
  return Object.keys(HOSTS).filter((h) => HOSTS[h].platform === platform);
}

// For platforms with exactly one host, ?host= can be omitted.
export function defaultHostFor(platform) {
  const hosts = hostsFor(platform);
  return hosts.length === 1 ? hosts[0] : null;
}
