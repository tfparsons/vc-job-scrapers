// Public ATS job feeds, one mapper each, all pure (text in, listings out).
// Shapes validated live on 16 Sep 2026 against Startup Universe companies:
// Ashby (metaview), Greenhouse (dexory), Lever (valarian), Workable
// (vortexa), Teamtailor (doctify), Recruitee (treasuryspring).

import { clean, stripTags } from "../lib/html.js";

const SLUG = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

function isoDate(value) {
  if (value == null) return null;
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : new Date(ms).toISOString().slice(0, 10);
}

function joinLoc(parts) {
  const seen = [];
  for (const p of parts) { const c = clean(p); if (c && !seen.includes(c)) seen.push(c); }
  return seen.length ? seen.join("; ") : null;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { throw new Error("non-JSON feed"); }
}

const listing = (o) => ({
  company: null, title: null, location: null, posted_date: null, posted_relative: null,
  seniority: null, salary_raw: null, remote: null, link: null, ...o,
});

// ---------- Ashby ----------
export function mapAshby(text) {
  const json = parseJson(text);
  if (!json || !Array.isArray(json.jobs)) throw new Error("feed shape unexpected");
  return json.jobs.filter((j) => j.isListed !== false).map((j) => listing({
    title: clean(j.title),
    location: joinLoc([j.location, ...(Array.isArray(j.secondaryLocations) ? j.secondaryLocations.map((s) => s && s.location) : [])]),
    posted_date: isoDate(j.publishedAt),
    // compensationTierSummary is the whole-line string the board shows, e.g. "£60K – £80K • Offers Equity".
    salary_raw: clean(j.compensation && j.compensation.compensationTierSummary),
    remote: typeof j.isRemote === "boolean" ? j.isRemote : null,
    link: typeof j.jobUrl === "string" && j.jobUrl ? j.jobUrl : null,
  }));
}

// ---------- Greenhouse ----------
export function mapGreenhouse(text) {
  const json = parseJson(text);
  if (!json || !Array.isArray(json.jobs)) throw new Error("feed shape unexpected");
  return json.jobs.map((j) => listing({
    company: clean(j.company_name),
    title: clean(j.title),
    location: clean(j.location && j.location.name),
    posted_date: isoDate(j.first_published) || isoDate(j.updated_at),
    link: typeof j.absolute_url === "string" && j.absolute_url ? j.absolute_url : null,
  }));
}

// ---------- Lever ----------
function leverSalary(r) {
  if (!r || !Number.isFinite(r.min) || !Number.isFinite(r.max)) return null;
  const fmt = (n) => n.toLocaleString("en-GB");
  return `${r.currency || ""} ${fmt(r.min)}-${fmt(r.max)}${r.interval ? ` / ${String(r.interval).replace(/-/g, " ")}` : ""}`.trim();
}

export function mapLever(text) {
  const json = parseJson(text);
  if (!Array.isArray(json)) throw new Error("feed shape unexpected");
  return json.map((j) => {
    const c = j.categories || {};
    const locs = Array.isArray(c.allLocations) && c.allLocations.length ? c.allLocations : [c.location];
    return listing({
      title: clean(j.text),
      location: joinLoc(locs),
      posted_date: isoDate(j.createdAt),
      seniority: null,
      salary_raw: leverSalary(j.salaryRange),
      remote: j.workplaceType ? /remote/i.test(String(j.workplaceType)) : null,
      link: typeof j.hostedUrl === "string" && j.hostedUrl ? j.hostedUrl : null,
    });
  });
}

// ---------- Workable ----------
export function mapWorkable(text) {
  const json = parseJson(text);
  if (!json || !Array.isArray(json.jobs)) throw new Error("feed shape unexpected");
  return json.jobs.map((j) => listing({
    company: clean(json.name),
    title: clean(j.title),
    location: joinLoc([[j.city, j.state, j.country].filter(Boolean).join(", "), ...(Array.isArray(j.locations) ? j.locations.map((l) => l && [l.city, l.country].filter(Boolean).join(", ")) : [])]),
    posted_date: isoDate(j.published_on) || isoDate(j.created_at),
    seniority: clean(j.experience),
    remote: typeof j.telecommuting === "boolean" ? j.telecommuting : null,
    link: typeof j.url === "string" && j.url ? j.url : null,
  }));
}

// ---------- Teamtailor (RSS with tt: location extension) ----------
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? m[1] : null; };

export function mapTeamtailor(text) {
  const xml = String(text);
  if (!/<rss[\s>]/i.test(xml)) throw new Error("feed shape unexpected");
  const items = xml.split(/<item>/).slice(1).map((s) => s.split("</item>")[0]);
  return items.map((it) => {
    const locs = [...it.matchAll(/<tt:location>([\s\S]*?)<\/tt:location>/g)].map((m) => [tag(m[1], "tt:city"), tag(m[1], "tt:country")].map(clean).filter(Boolean).join(", "));
    const status = clean(tag(it, "remoteStatus"));
    return listing({
      title: clean(stripTags(tag(it, "title") || "")),
      location: joinLoc(locs),
      posted_date: isoDate(tag(it, "pubDate")),
      remote: status ? /fully|remote/i.test(status) && !/hybrid/i.test(status) : null,
      link: clean(tag(it, "link")),
    });
  });
}

// ---------- Recruitee ----------
export function mapRecruitee(text) {
  const json = parseJson(text);
  if (!json || !Array.isArray(json.offers)) throw new Error("feed shape unexpected");
  return json.offers.filter((o) => !o.status || o.status === "published").map((o) => listing({
    company: clean(o.company_name),
    title: clean(o.title),
    location: joinLoc([o.location, [o.city, o.country].filter(Boolean).join(", ")]),
    posted_date: isoDate(o.published_at) || isoDate(o.created_at),
    salary_raw: clean(o.salary && typeof o.salary === "string" ? o.salary : null),
    remote: typeof o.remote === "boolean" ? o.remote : null,
    link: typeof o.careers_url === "string" && o.careers_url ? o.careers_url : null,
  }));
}

// Endpoint name -> feed URL(s) to try in order, and the mapper. Greenhouse
// boards on the EU data centre answer only on the EU API, hence two URLs.
export const FEEDS = {
  ashby: { key: "slug", urls: (s) => [`https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`], map: mapAshby },
  greenhouse: { key: "slug", urls: (s) => [`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, `https://boards-api.eu.greenhouse.io/v1/boards/${s}/jobs`], map: mapGreenhouse },
  lever: { key: "slug", urls: (s) => [`https://api.lever.co/v0/postings/${s}?mode=json&limit=500`, `https://api.eu.lever.co/v0/postings/${s}?mode=json&limit=500`], map: mapLever },
  workable: { key: "slug", urls: (s) => [`https://apply.workable.com/api/v1/widget/accounts/${s}`], map: mapWorkable },
  teamtailor: { key: "host", urls: (h) => [`https://${h}/jobs.rss?per_page=200`], map: mapTeamtailor },
  recruitee: { key: "slug", urls: (s) => [`https://${s}.recruitee.com/api/offers/`], map: mapRecruitee },
};

export function validSlug(s) {
  return typeof s === "string" && SLUG.test(s.trim()) ? s.trim() : null;
}
