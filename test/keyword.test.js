import { test } from "node:test";
import assert from "node:assert/strict";
import { mapAdzuna, mapReed, mapWorkableSearch, mapRevopsCareers, mapClayCommunity } from "../src/scrapers/keyword-feeds.js";
import { scrapeKeyword, validPhrase } from "../src/scrapers/keyword.js";
import { expectSnapshot, fixture } from "./helpers.js";

const NOW = new Date("2026-09-16T06:30:00Z");
const CONTRACT = ["company", "title", "location", "posted_date", "posted_relative", "seniority", "salary_raw", "remote", "link"];

function checkContract(list) {
  assert.ok(list.length > 0);
  for (const l of list) {
    assert.deepEqual(Object.keys(l).sort(), [...CONTRACT].sort());
    assert.ok(l.title, "title present");
    assert.match(l.link, /^https:\/\//);
    if (l.posted_date !== null) assert.match(l.posted_date, /^\d{4}-\d{2}-\d{2}$/);
  }
}

test("keyword: Adzuna keeps stated salaries only and strips the tracking query", () => {
  const list = mapAdzuna(fixture("kw-adzuna.json"));
  checkContract(list);
  assert.equal(list[0].salary_raw, "GBP 70,000-90,000");
  assert.equal(list[1].salary_raw, null, "predicted salary dropped");
  assert.equal(list[1].title, "Senior Revenue Operations Manager", "highlight tags stripped");
  assert.equal(list[0].link, "https://www.adzuna.co.uk/jobs/land/ad/4912345678");
  assert.equal(list[0].posted_date, "2026-09-15");
});

test("keyword: Reed dates are dd/mm/yyyy and salary needs both ends", () => {
  const list = mapReed(fixture("kw-reed.json"));
  checkContract(list);
  assert.equal(list[0].posted_date, "2026-09-14");
  assert.equal(list[0].salary_raw, "GBP 60,000-75,000");
  assert.equal(list[1].salary_raw, null);
});

test("keyword: Jobs by Workable search maps to the contract (snapshot)", () => {
  const { listings, next } = mapWorkableSearch(fixture("kw-workable-search.json"));
  checkContract(listings);
  assert.ok(next, "page token passed on");
  const gtm = listings.find((l) => l.title === "GTM Engineer");
  assert.ok(gtm && gtm.company && /London|United Kingdom/.test(gtm.location));
  expectSnapshot("kw-workable-search", listings);
});

test("keyword: RevOps Careers job feed maps structured fields (snapshot)", () => {
  const list = mapRevopsCareers(fixture("kw-revopscareers.xml"));
  checkContract(list);
  assert.ok(list.every((l) => l.company && l.location), "company and location from job_listing tags");
  assert.ok(list.every((l) => /^https:\/\/revopscareers\.com\/job\//.test(l.link)));
  expectSnapshot("kw-revopscareers", list);
});

test("keyword: Clay community posts get company and a location hint from the title (snapshot)", () => {
  const list = mapClayCommunity(fixture("kw-clay.xml"));
  checkContract(list);
  const sprinto = list.find((l) => /Sprinto/.test(l.title));
  assert.equal(sprinto.company, "Sprinto");
  assert.equal(sprinto.location, "India-based");
  assert.equal(sprinto.remote, true);
  expectSnapshot("kw-clay", list);
});

test("keyword: phrase guard", () => {
  assert.equal(validPhrase("GTM Engineer"), "GTM Engineer");
  assert.equal(validPhrase("Go-to-Market Engineer"), "Go-to-Market Engineer");
  assert.equal(validPhrase("x"), null);
  assert.equal(validPhrase("a<script>"), null);
});

const CONFIG = { terms: ["gtm", "revenue operations"], location_keep: ["london", "united kingdom", "uk"], remote_exclude: ["united states", "usa", "us", "india"], max_age_days: 7 };

test("keyword: a missing secret is an error, not a crash, and nothing is fetched", async () => {
  let called = false;
  const out = await scrapeKeyword({ name: "adzuna", q: "GTM Engineer", env: {}, now: NOW, config: CONFIG, fetch: async () => { called = true; } });
  assert.equal(out.error, "adzuna: secret not set: ADZUNA_APP_ID, ADZUNA_APP_KEY");
  assert.equal(called, false);
});

test("keyword: Adzuna call carries the phrase, London and the recency window; title filter applies", async () => {
  const urls = [];
  const fetchImpl = async (u) => { urls.push(String(u)); return new Response(fixture("kw-adzuna.json"), { status: 200 }); };
  const out = await scrapeKeyword({ name: "adzuna", q: "GTM Engineer", env: { ADZUNA_APP_ID: "id", ADZUNA_APP_KEY: "key" }, now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.equal(out.error, null);
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get("what_phrase"), "GTM Engineer");
  assert.equal(u.searchParams.get("where"), "London");
  assert.equal(u.searchParams.get("max_days_old"), "7");
  assert.equal(out.counts.fetched, 2);
  assert.deepEqual(out.listings.map((l) => l.title), ["GTM Engineer", "Senior Revenue Operations Manager"], "Manchester, UK is kept: the keep-list names the UK");
  assert.deepEqual(out.listings[0].matched_terms, ["gtm engineer", "gtm"]);
  assert.deepEqual(out.listings[1].matched_terms, ["revenue operations"]);
});

test("keyword: Reed sends the key as basic auth username", async () => {
  let auth = null;
  const fetchImpl = async (u, init) => { auth = init.headers.authorization; return new Response(fixture("kw-reed.json"), { status: 200 }); };
  const out = await scrapeKeyword({ name: "reed", q: "Marketing Operations", env: { REED_API_KEY: "k123" }, now: NOW, config: { ...CONFIG, max_age_days: 3650 }, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.equal(auth, `Basic ${btoa("k123:")}`);
  assert.equal(out.listings.length, 1, "only the title matching the phrase or a term survives");
});

test("keyword: a 401 says to check the key", async () => {
  const out = await scrapeKeyword({ name: "reed", q: "GTM Engineer", env: { REED_API_KEY: "bad" }, now: NOW, config: CONFIG, fetch: async () => new Response("", { status: 401 }) });
  assert.equal(out.error, "reed: HTTP 401 (check the API key secret)");
});

test("keyword: Workable search quotes the phrase and pages with pageToken", async () => {
  const urls = [];
  const page2 = JSON.stringify({ jobs: [], nextPageToken: null });
  const fetchImpl = async (u) => { urls.push(String(u)); return new Response(urls.length === 1 ? fixture("kw-workable-search.json") : page2, { status: 200 }); };
  const out = await scrapeKeyword({ name: "workable-search", q: "GTM Engineer", env: {}, now: NOW, config: { ...CONFIG, max_age_days: 3650 }, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[0]).searchParams.get("query"), '"GTM Engineer"');
  assert.ok(new URL(urls[1]).searchParams.get("pageToken"));
  assert.ok(out.listings.every((l) => /gtm/i.test(l.title)));
});
