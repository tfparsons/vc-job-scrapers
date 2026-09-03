import { test } from "node:test";
import assert from "node:assert/strict";
import { parseA16zPage, cleanLink, scrapeA16z } from "../src/scrapers/a16z.js";
import { expectSnapshot, fixture, NOW } from "./helpers.js";

const PAGE = fixture("a16z-gtm-7d.html");

test("a16z: cards parse with ATS links, dates and salary lines (snapshot)", () => {
  const cards = parseA16zPage(PAGE);
  assert.ok(cards.length >= 5, `expected a page of cards, got ${cards.length}`);
  for (const c of cards) {
    assert.ok(c.company, "company");
    assert.ok(c.title, "title");
    assert.match(c.link, /^https?:\/\//);
    assert.doesNotMatch(c.link, /lever-source|gh_src|utm_/, "tracking params stripped");
    assert.match(c.posted_date, /^\d{4}-\d{2}-\d{2}$/, "posted=7 results always carry a date");
    assert.ok(c.location === null || !/Posted/.test(c.location), "posted text never leaks into location");
    if (c.salary_raw) assert.match(c.salary_raw, /^(USD|GBP|EUR|CAD|AUD|CHF|SEK|[$£€])/);
  }
  expectSnapshot("a16z-gtm-7d", cards);
});

test("a16z: cleanLink strips tracking only", () => {
  assert.equal(cleanLink("https://jobs.lever.co/x/123?lever-source%5B%5D=portfoliojobs.a16z.com"), "https://jobs.lever.co/x/123");
  assert.equal(cleanLink("https://job-boards.greenhouse.io/x/jobs/1?gh_src=abc&utm_source=a16z"), "https://job-boards.greenhouse.io/x/jobs/1");
  assert.equal(cleanLink("https://example.com/job?id=7"), "https://example.com/job?id=7");
});

test("a16z: one GET per term with posted=<days>, union on link", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return new Response(PAGE, { status: 200 }); };
  const config = { terms: ["gtm", "growth"], location_keep: null, max_age_days: 7 };
  const out = await scrapeA16z({ now: NOW, config, fetch: fetchImpl });
  assert.deepEqual(calls, ["https://jobs.a16z.com/jobs?q=gtm&posted=7", "https://jobs.a16z.com/jobs?q=growth&posted=7"]);
  assert.equal(out.error, null);
  assert.equal(out.counts.fetched, 2 * out.counts.unique);
  assert.deepEqual(out.listings[0].matched_terms, ["gtm", "growth"]);
});
