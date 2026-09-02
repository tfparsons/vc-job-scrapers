import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { relativeToDate, isStaleRelative } from "../src/lib/relative-date.js";
import { parseSetCookies, cookieHeaderFrom, setCookiesFromResponse } from "../src/lib/cookies.js";
import { decodeEntities, stripTags, clean } from "../src/lib/html.js";
import { unionByLink, keepByLocation, keepByRecency, runFilters } from "../src/lib/filter.js";
import { mapPool } from "../src/lib/http.js";
import { LOCATION_KEEP } from "../src/config.js";
import { HOSTS, lookupHost, hostsFor } from "../src/allowlist.js";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-09-02T06:30:00Z");

// Snapshot helper: run with UPDATE_SNAPSHOTS=1 to rewrite.
export function expectSnapshot(name, value) {
  const file = join(here, "snapshots", `${name}.json`);
  const json = JSON.stringify(value, null, 2) + "\n";
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) {
    writeFileSync(file, json);
    return;
  }
  assert.deepEqual(JSON.parse(json), JSON.parse(readFileSync(file, "utf8")), `snapshot ${name} differs; run npm run test:update if intended`);
}

export function fixture(name) {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

// ---------- relative-date ----------

test("relativeToDate parses hours, days, weeks against now", () => {
  const cases = [
    ["1 day", "2026-09-01"],
    ["4 days", "2026-08-29"],
    ["3 hours", "2026-09-02"],
    ["Posted: 7 days", "2026-08-26"],
    ["2 weeks", "2026-08-19"],
    ["a day ago", "2026-09-01"],
    ["1 month", null],
    ["3 months", null],
    ["1 year", null],
    ["yesterday-ish", null],
    ["", null],
    [null, null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(relativeToDate(input, NOW), expected, `input ${JSON.stringify(input)}`);
  }
});

test("isStaleRelative flags months and years only", () => {
  assert.equal(isStaleRelative("1 month"), true);
  assert.equal(isStaleRelative("2 years"), true);
  assert.equal(isStaleRelative("29 days"), false);
  assert.equal(isStaleRelative(null), false);
});

// ---------- cookies ----------

test("cookies: rebuilds a Cookie header, honours _remove_, ignores attributes with commas", () => {
  const lines = [
    "session=abc123; path=/; expires=Wed, 09 Sep 2026 12:45:10 GMT; httponly; secure",
    "session.sig=-isl7U8IFBilFKpi3Q0S-okMrhQ; path=/; HTTPOnly; Secure",
    "AWSALBAPP-0=AAAAxyz; Expires=Wed, 09 Sep 2026 12:45:10 GMT; Path=/",
    "AWSALBAPP-1=_remove_; Expires=Wed, 09 Sep 2026 12:45:10 GMT; Path=/",
    "AWSALBAPP-2=_remove_; Path=/",
    "session=def456; path=/",
  ];
  const jar = parseSetCookies(lines);
  assert.equal(cookieHeaderFrom(jar), "session=def456; session.sig=-isl7U8IFBilFKpi3Q0S-okMrhQ; AWSALBAPP-0=AAAAxyz");
});

test("cookies: reads Set-Cookie from a real Response via getSetCookie", () => {
  const h = new Headers();
  h.append("set-cookie", "a=1; Expires=Wed, 09 Sep 2026 12:45:10 GMT");
  h.append("set-cookie", "b=2");
  const res = new Response("", { headers: h });
  const jar = parseSetCookies(setCookiesFromResponse(res));
  assert.equal(cookieHeaderFrom(jar), "a=1; b=2");
});

// ---------- html ----------

test("html: decodes named and numeric entities, strips tags", () => {
  assert.equal(decodeEntities("Data &amp; Attribution"), "Data & Attribution");
  assert.equal(decodeEntities("It&#x27;s &#39;fine&#39; &lt;b&gt;"), "It's 'fine' <b>");
  assert.equal(decodeEntities("&unknown; stays"), "&unknown; stays");
  assert.equal(stripTags("<p>GTM <b>Engineer</b></p><span>London</span>"), "GTM Engineer London");
  assert.equal(clean("  spaced   out  "), "spaced out");
  assert.equal(clean(""), null);
  assert.equal(clean(null), null);
});

// ---------- filter ----------

function listing(overrides) {
  return {
    company: "Co", title: "GTM Engineer", location: "London, UK", posted_date: "2026-09-01",
    posted_relative: null, seniority: null, salary_raw: null, remote: null,
    link: "https://example.com/jobs/1", ...overrides,
  };
}

test("filter: union dedupes on link and records matched terms in term order", () => {
  const a = listing({ link: "https://x/1" });
  const b = listing({ link: "https://x/2" });
  const { listings, fetched } = unionByLink([
    { term: "gtm", listings: [a, b] },
    { term: "growth", listings: [{ ...a }] },
  ]);
  assert.equal(fetched, 3);
  assert.equal(listings.length, 2);
  assert.deepEqual(listings[0].matched_terms, ["gtm", "growth"]);
  assert.deepEqual(listings[1].matched_terms, ["gtm"]);
});

test("filter: location keep-list semantics", () => {
  const cases = [
    [{ location: null }, true, "null location keeps"],
    [{ location: "" }, true, "empty location keeps"],
    [{ location: "London, UK" }, true],
    [{ location: "Paris, France" }, false],
    [{ location: "Remote - EMEA" }, true],
    [{ location: "Berlin, Germany; Remote" }, true],
    [{ location: "United States" }, false],
    [{ location: "New York, NY, USA", remote: true }, true, "remote flag keeps"],
    [{ location: "Dublin, Ireland" }, false, "Ireland is not in the keep-list"],
  ];
  for (const [over, expected, label] of cases) {
    assert.equal(keepByLocation(listing(over), LOCATION_KEEP), expected, label || JSON.stringify(over));
  }
  assert.equal(keepByLocation(listing({ location: "Paris, France" }), null), true, "loc=all keeps everything");
});

test("filter: recency keeps nulls, drops stale relatives, is inclusive at the boundary", () => {
  const cases = [
    [{ posted_date: "2026-09-02" }, true],
    [{ posted_date: "2026-08-26" }, true, "exactly 7 days keeps"],
    [{ posted_date: "2026-08-25" }, false, "8 days drops"],
    [{ posted_date: null }, true, "null date keeps"],
    [{ posted_date: null, posted_relative: "3 months" }, false, "null date but board says months drops"],
    [{ posted_date: null, posted_relative: "6 days" }, true],
    [{ posted_date: "not a date" }, true, "unparseable keeps"],
  ];
  for (const [over, expected, label] of cases) {
    assert.equal(keepByRecency(listing(over), 7, NOW), expected, label || JSON.stringify(over));
  }
  assert.equal(keepByRecency(listing({ posted_date: "2026-08-10" }), 30, NOW), true, "days=30 widens");
});

test("filter: runFilters produces counts that add up", () => {
  const hits = [
    { term: "gtm", listings: [
      listing({ link: "https://x/1" }),
      listing({ link: "https://x/2", location: "Paris, France" }),
      listing({ link: "https://x/3", posted_date: "2026-08-01" }),
    ] },
    { term: "growth", listings: [listing({ link: "https://x/1" })] },
  ];
  const { listings, counts } = runFilters(hits, { locationKeep: LOCATION_KEEP, maxAgeDays: 7, now: NOW });
  assert.deepEqual(counts, { fetched: 4, unique: 3, after_location: 2, after_recency: 1 });
  assert.equal(listings.length, counts.after_recency);
  assert.deepEqual(listings[0].matched_terms, ["gtm", "growth"]);
});

// ---------- http ----------

test("mapPool keeps input order and isolates failures", async () => {
  const seen = [];
  const results = await mapPool([30, 5, 10, 1], async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    seen.push(ms);
    if (ms === 10) throw new Error("boom");
    return ms * 2;
  }, 2);
  assert.deepEqual(results, [
    { ok: true, value: 60 }, { ok: true, value: 10 }, { ok: false, error: "boom" }, { ok: true, value: 2 },
  ]);
  assert.equal(seen.length, 4);
});

// ---------- allowlist ----------

test("allowlist: 8 consider + 9 getro hosts, lookup is platform-scoped and lowercases", () => {
  assert.equal(hostsFor("consider").length, 8);
  assert.equal(hostsFor("getro").length, 9);
  assert.equal(Object.keys(HOSTS).length, 17);
  assert.deepEqual(lookupHost("Jobs.Notion.VC", "consider"), { host: "jobs.notion.vc", platform: "consider", source: "notion" });
  assert.equal(lookupHost("jobs.notion.vc", "getro"), null);
  assert.equal(lookupHost("evil.example", "getro"), null);
  assert.equal(lookupHost("jobs.notion.vc/../x", "consider"), null);
  assert.equal(lookupHost(null, "consider"), null);
});
