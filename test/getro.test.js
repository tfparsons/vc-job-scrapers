import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGetroPage, scrapeGetro } from "../src/scrapers/getro.js";
import { expectSnapshot, fixture, NOW } from "./helpers.js";

const PAGE = fixture("getro-dawn-gtm.html");
const HOST = "jobs.dawncapital.com";

test("getro: Dawn page parses into 20 cards (snapshot) with clean fields", () => {
  const { cards, poweredByGetro } = parseGetroPage(PAGE, HOST, NOW);
  assert.equal(poweredByGetro, true);
  assert.equal(cards.length, 20);
  for (const c of cards) {
    assert.ok(c.company, "company present");
    assert.ok(c.title, "title present");
    assert.match(c.link, /^https:\/\/jobs\.dawncapital\.com\/companies\/[^/]+\/jobs\/\d+-/);
    assert.doesNotMatch(c.link, /#/, "#content stripped");
    assert.doesNotMatch(c.title, /&amp;|&#/, "entities decoded");
    if (c.posted_date !== null) assert.match(c.posted_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(c.remote, null);
  }
  const ably = cards.find((c) => c.company === "Ably");
  assert.equal(ably.title, "GTM Engineer");
  assert.equal(ably.location, "London, UK; Remote");
  assert.equal(ably.posted_relative, "9 days");
  assert.equal(ably.seniority, "Mid-Senior Level");
  assert.equal(ably.salary_raw, null);

  const oneleet = cards.find((c) => c.company === "Oneleet");
  assert.equal(oneleet.title, "GTM AI Engineer - Data & Attribution");

  const raito = cards.find((c) => c.company === "Raito" && /People Partner/.test(c.title));
  assert.equal(raito.salary_raw, "USD 168k-210k / year + Equity");
  assert.equal(raito.seniority, "Senior");

  const soldo = cards.find((c) => c.company === "Soldo");
  assert.equal(soldo.posted_relative, "1 month");

  const inforcer = cards.find((c) => c.company === "Inforcer" && /Talent Partner - US/.test(c.title));
  assert.equal(inforcer.location, null, "no location on the board stays null");

  expectSnapshot("getro-dawn-gtm", cards);
});

test("getro: relative text is the fallback when datePosted is missing", () => {
  const html = `<div data-testid="job-list-item"><meta itemProp="description" content="GTM Lead at Zinc"/>
    <a href="/companies/zinc-3/jobs/91587943-gtm-lead#content" data-testid="job-title-link"><span class="x job-title-text"><span class="y">GTM Lead</span></span></a>
    <meta itemProp="name" content="Zinc"/><meta itemProp="addressLocality" content="London, UK"/>
    <span>Posted:</span> <span>4 days</span> <span>Senior</span> <a>View job</a></div><footer>Powered by Getro.com</footer>`;
  const { cards } = parseGetroPage(html, "talent.seedcamp.com", NOW);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].posted_date, "2026-08-29");
  assert.equal(cards[0].link, "https://talent.seedcamp.com/companies/zinc-3/jobs/91587943-gtm-lead");
  assert.equal(cards[0].seniority, "Senior");
});

test("getro: title falls back to description minus ' at <company>'", () => {
  const html = `<div data-testid="job-list-item"><meta itemProp="description" content="Growth Manager at Monq"/>
    <a href="/companies/monq/jobs/1-growth-manager"></a><meta itemProp="name" content="Monq"/></div>`;
  const { cards } = parseGetroPage(html, "talent.seedcamp.com", NOW);
  assert.equal(cards[0].title, "Growth Manager");
  assert.equal(cards[0].location, null);
  assert.equal(cards[0].posted_date, null);
});

function stubFetch(bodyFor) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = bodyFor(String(url));
    return new Response(r.body, { status: r.status || 200, headers: { "content-type": "text/html" } });
  };
  return { fetchImpl, calls };
}

const CONFIG = { terms: ["gtm", "growth"], location_keep: null, max_age_days: 3650 };

test("getro: term loop unions on link and encodes terms in the URL", async () => {
  const { fetchImpl, calls } = stubFetch(() => ({ body: PAGE }));
  const out = await scrapeGetro({ host: HOST, now: NOW, config: { ...CONFIG, terms: ["gtm", "revenue operations"] }, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.deepEqual(calls.map((c) => c.url), [
    "https://jobs.dawncapital.com/jobs?q=gtm",
    "https://jobs.dawncapital.com/jobs?q=revenue%20operations",
  ]);
  assert.match(calls[0].init.headers["user-agent"], /^VC-Job-Scrapers\/2\.0/);
  assert.deepEqual(out.counts, { fetched: 40, unique: 20, after_location: 20, after_recency: 20 });
  assert.deepEqual(out.listings[0].matched_terms, ["gtm", "revenue operations"]);
});

test("getro: default filters keep London/UK/remote within 7 days", async () => {
  const { fetchImpl } = stubFetch(() => ({ body: PAGE }));
  const config = { terms: ["gtm"], location_keep: ["london", "united kingdom", "uk", "emea", "europe"], remote_exclude: ["united states", "usa", "us"], max_age_days: 7 };
  const out = await scrapeGetro({ host: HOST, now: NOW, config, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.ok(out.counts.after_recency < out.counts.after_location);
  for (const l of out.listings) {
    const named = l.location === null || /london|united kingdom|\buk\b|emea|europe/i.test(l.location);
    const remoteOk = /remote/i.test(l.location) && !/united states|usa|\bus\b/i.test(l.location);
    assert.ok(named || remoteOk, l.location);
  }
  assert.ok(out.listings.some((l) => l.company === "Oneleet"), "United States; Europe; Remote is kept because Europe is named");
  assert.ok(!out.listings.some((l) => /New York/.test(l.location || "")), "on-site US dropped");
  assert.ok(out.listings.some((l) => l.company === "Inforcer"), "no-location listing kept");
  assert.ok(!out.listings.some((l) => l.company === "Soldo"), "1 month old dropped");
});

test("getro: zero cards on every term with a Getro footer is reported as a DOM change", async () => {
  const { fetchImpl } = stubFetch(() => ({ body: "<html><footer>Powered by Getro.com</footer></html>" }));
  const out = await scrapeGetro({ host: HOST, now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.deepEqual(out.listings, []);
  assert.equal(out.error, "getro: 0 cards on all terms (DOM change?)");
});

test("getro: partial failures keep the union and say so", async () => {
  const { fetchImpl } = stubFetch((url) => (url.endsWith("growth") ? { status: 503, body: "down" } : { body: PAGE }));
  const out = await scrapeGetro({ host: HOST, now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.equal(out.counts.unique, 20);
  assert.equal(out.error, "partial: 1/2 term fetches failed: HTTP 503 for growth");
});

test("getro: every term failing yields an error and no listings", async () => {
  const { fetchImpl } = stubFetch(() => ({ status: 500, body: "" }));
  const out = await scrapeGetro({ host: HOST, now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.deepEqual(out.listings, []);
  assert.equal(out.error, "getro: HTTP 500 for gtm");
});
