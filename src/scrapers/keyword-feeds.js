// Keyword sources (Session E): whole-market search APIs and feeds, one pure
// mapper each (text in, contract listings out). Shapes validated live on
// 16 Sep 2026 unless marked: Jobs by Workable search, RevOps Careers job
// feed, Clay community share-jobs RSS. Adzuna and Reed follow their public
// API docs and are re-checked against a live call before n8n uses them.

import { clean, stripTags, decodeEntities } from "../lib/html.js";

const listing = (o) => ({
  company: null, title: null, location: null, posted_date: null, posted_relative: null,
  seniority: null, salary_raw: null, remote: null, link: null, ...o,
});

function isoDate(value) {
  if (value == null || value === "") return null;
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const uk = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // Reed: dd/mm/yyyy
  if (uk) return `${uk[3]}-${uk[2]}-${uk[1]}`;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { throw new Error("non-JSON response"); }
}

const money = (n) => Math.round(n).toLocaleString("en-GB");

// ---------- Adzuna ----------
export function mapAdzuna(text) {
  const json = parseJson(text);
  if (!json || !Array.isArray(json.results)) throw new Error("response shape unexpected");
  return json.results.map((r) => {
    // Adzuna estimates salaries it cannot see; only a stated one is kept.
    const predicted = r.salary_is_predicted === 1 || r.salary_is_predicted === "1";
    const salary = !predicted && Number.isFinite(r.salary_min) && Number.isFinite(r.salary_max)
      ? `GBP ${money(r.salary_min)}-${money(r.salary_max)}` : null;
    return listing({
      company: clean(r.company && r.company.display_name),
      title: clean(stripTags(r.title || "")),
      location: clean(r.location && r.location.display_name),
      posted_date: isoDate(r.created),
      salary_raw: salary,
      link: typeof r.redirect_url === "string" && r.redirect_url ? r.redirect_url.split("?")[0] : null,
    });
  });
}

// ---------- Reed ----------
export function mapReed(text) {
  const json = parseJson(text);
  if (!json || !Array.isArray(json.results)) throw new Error("response shape unexpected");
  return json.results.map((r) => listing({
    company: clean(r.employerName),
    title: clean(r.jobTitle),
    location: clean(r.locationName),
    posted_date: isoDate(r.date),
    salary_raw: Number.isFinite(r.minimumSalary) && Number.isFinite(r.maximumSalary) && r.maximumSalary > 0
      ? `${r.currency || "GBP"} ${money(r.minimumSalary)}-${money(r.maximumSalary)}` : null,
    link: typeof r.jobUrl === "string" && r.jobUrl ? r.jobUrl : null,
  }));
}

// ---------- Jobs by Workable (cross-company search) ----------
export function mapWorkableSearch(text) {
  const json = parseJson(text);
  if (!json || !Array.isArray(json.jobs)) throw new Error("response shape unexpected");
  return {
    next: typeof json.nextPageToken === "string" && json.nextPageToken ? json.nextPageToken : null,
    listings: json.jobs.filter((j) => !j.state || j.state === "published").map((j) => {
      const l = j.location || {};
      return listing({
        company: clean(j.company && j.company.title),
        title: clean(j.title),
        location: clean([l.city, l.subregion, l.countryName].filter(Boolean).join(", ")) || clean((j.locations || []).join("; ")),
        posted_date: isoDate(j.created),
        remote: j.workplace ? j.workplace === "remote" : null,
        link: typeof j.url === "string" && j.url ? j.url : null,
      });
    }),
  };
}

// ---------- RSS helpers ----------
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1") : null;
};

function rssItems(text) {
  const xml = String(text);
  if (!/<rss[\s>]/i.test(xml)) throw new Error("feed shape unexpected");
  return xml.split(/<item>/).slice(1).map((s) => s.split("</item>")[0]);
}

// ---------- RevOps Careers (WP Job Manager job_feed) ----------
export function mapRevopsCareers(text) {
  return rssItems(text).map((it) => {
    const type = clean(tag(it, "job_listing:job_type"));
    return listing({
      company: clean(decodeEntities(tag(it, "job_listing:company") || "")),
      title: clean(decodeEntities(tag(it, "title") || "")),
      location: clean(decodeEntities(tag(it, "job_listing:location") || "")),
      posted_date: isoDate(tag(it, "pubDate")),
      salary_raw: clean(decodeEntities(tag(it, "job_listing:salary") || "")),
      remote: type ? /remote/i.test(type) : null,
      link: clean(tag(it, "link")),
    });
  });
}

// ---------- Clay community share-jobs (free-text posts) ----------
// No structured fields. The title usually reads "Hiring: <role> at <Company>
// (Remote, $x)" so company and a location hint are pulled from it; when the
// title has no parenthetical, location stays null and the post is kept.
export function mapClayCommunity(text) {
  return rssItems(text).map((it) => {
    const title = clean(decodeEntities(tag(it, "title") || "")) || "";
    const role = title.replace(/^hiring(\s+now)?\s*:?\s*/i, "");
    const at = role.match(/\bat\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/);
    const paren = title.match(/\(([^)]*)\)\s*$/);
    return listing({
      company: at ? clean(at[1]) : null,
      title,
      location: paren ? clean(paren[1]) : null,
      posted_date: isoDate(tag(it, "pubDate")),
      remote: /\bremote\b/i.test(title) ? true : null,
      link: clean(tag(it, "link")),
    });
  });
}
