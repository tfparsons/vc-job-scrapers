import { test } from "node:test";
import assert from "node:assert/strict";
import { mapYcJobs, scrapeYc, YC_EXTRA_TERMS } from "../src/scrapers/yc.js";
import { expectSnapshot, fixture, NOW } from "./helpers.js";

const SEARCH = fixture("yc-search-gtm.json");

test("yc: search JSON maps to the contract (snapshot)", () => {
  const json = JSON.parse(SEARCH);
  const listings = mapYcJobs(json);
  assert.equal(listings.length, json.jobs.length);
  assert.ok(listings.length > 0);
  for (const l of listings) {
    assert.match(l.link, /^https:\/\/www\.workatastartup\.com\/jobs\/\d+$/);
    assert.ok(l.company && l.title);
    assert.equal(l.posted_date, null);
    assert.ok(l.salary_raw === null || typeof l.salary_raw === "string");
  }
  expectSnapshot("yc-search-gtm", listings);
});

test("yc: term loop adds the location words, unions on link, reports partial failures", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("q=growth")) return new Response("Not Acceptable", { status: 406 });
    return new Response(SEARCH, { status: 200, headers: { "content-type": "application/json" } });
  };
  const config = { terms: ["gtm", "growth"], location_keep: null, max_age_days: 7 };
  const out = await scrapeYc({ now: NOW, config, fetch: fetchImpl });
  const urls = calls.map((c) => c.url);
  assert.equal(urls.length, 2 + YC_EXTRA_TERMS.length);
  assert.ok(urls.includes("https://www.workatastartup.com/jobs/search?q=gtm"));
  assert.ok(urls.includes("https://www.workatastartup.com/jobs/search?q=united%20kingdom"));
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal(out.counts.unique, 30);
  assert.equal(out.counts.after_recency, 30, "no dates means recency keeps everything");
  assert.match(out.error, /^partial: 1\/4 term fetches failed: HTTP 406 for growth/);
});

test("yc: default location rules drop US-remote and keep GB", async () => {
  const fetchImpl = async () => new Response(SEARCH, { status: 200 });
  const config = { terms: ["gtm"], location_keep: ["london", "united kingdom", "uk", "england", "emea", "europe"], remote_exclude: ["united states", "usa", "us"], max_age_days: 7 };
  const out = await scrapeYc({ now: NOW, config, fetch: fetchImpl });
  assert.ok(out.counts.after_location < out.counts.unique);
  for (const l of out.listings) {
    assert.doesNotMatch(l.location || "", /Remote \(US\)|, US$/, l.location);
  }
});
