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
};

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

export function hostsFor(platform) {
  return Object.keys(HOSTS).filter((h) => HOSTS[h].platform === platform);
}
