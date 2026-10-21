// Keyword sources: whole-market search APIs and feeds, one pure
// mapper each (text in, contract listings out). Shapes validated live on
// 16 Sep 2026 unless marked: Jobs by Workable search, RevOps Careers job
// feed; the Clay job board CSV on 12 Oct 2026. Adzuna and Reed follow their public
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

// ---------- Clay job board (clay.com/job-board) ----------
// The page renders a public CSV with columns title, company, location, logo,
// link, category. Roles are ones that ask for Clay, posted by employers; the
// link is the employer's own ATS URL, so it is canonical and matches the same
// role polled from that ATS. No posted date and no salary are given.
export function mapClayJobBoard(text) {
  const [head = [], ...rows] = parseCsv(text);
  const col = Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), i]));
  return rows
    .filter((r) => r.length > 1)
    .map((r) => listing({
      company: clean(r[col.company]),
      title: clean(r[col.title]),
      location: clean(r[col.location]),
      // One employer posts an http:// ATS link; the poller's links are https.
      link: clean(r[col.link])?.replace(/^http:\/\//i, "https://") ?? null,
    }))
    .filter((l) => l.title && l.link);
}

// RFC 4180 CSV: quoted fields may hold commas, newlines and doubled quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
