import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseDomain, parseGetroNetworkId, mapGetroCompanies, mapConsiderCompanies, scrapeCompanies,
} from "../src/scrapers/companies.js";
import { expectSnapshot, fixture } from "./helpers.js";

const GETRO_PAGE = fixture("getro-dawn-companies-page.html");
const GETRO_SEARCH = fixture("getro-dawn-companies-search.json");
const CONSIDER_PAGE = fixture("consider-notion-page.html");
const CONSIDER_SEARCH = fixture("consider-notion-companies.json");

test("companies: domains are normalised to a bare host", () => {
  assert.equal(normaliseDomain("https://www.Ably.com/about?x=1"), "ably.com");
  assert.equal(normaliseDomain("ably.com."), "ably.com");
  assert.equal(normaliseDomain("Ably"), null);
  assert.equal(normaliseDomain(""), null);
  assert.equal(normaliseDomain(null), null);
});

test("companies: Getro network id is read from __NEXT_DATA__", () => {
  assert.equal(parseGetroNetworkId(GETRO_PAGE), "3063");
  assert.equal(parseGetroNetworkId("<html>nothing</html>"), null);
  assert.equal(parseGetroNetworkId('<script id="__NEXT_DATA__" type="application/json">{bad</script>'), null);
});

test("companies: Getro search maps to the contract (snapshot)", () => {
  const list = mapGetroCompanies(JSON.parse(GETRO_SEARCH), "jobs.dawncapital.com");
  assert.equal(list.length, 8);
  const ably = list.find((c) => c.name === "Ably");
  assert.equal(ably.domain, "ably.com");
  assert.match(ably.location, /London, UK/);
  assert.equal(ably.stage, "series_b");
  assert.equal(ably.jobs_count, 7);
  assert.deepEqual(ably.ats, []);
  assert.equal(ably.link, "https://jobs.dawncapital.com/companies/ably-2");
  expectSnapshot("getro-dawn-companies", list);
});

test("companies: Consider search maps to the contract (snapshot)", () => {
  const list = mapConsiderCompanies(JSON.parse(CONSIDER_SEARCH), "https://jobs.notion.vc");
  assert.equal(list.length, 6);
  for (const c of list) {
    assert.ok(c.name);
    assert.match(c.domain, /\.[a-z]+$/);
    assert.match(c.link, /^https:\/\/jobs\.notion\.vc\/companies\//);
  }
  const isembard = list.find((c) => c.name === "Isembard");
  assert.equal(isembard.location, "London; Carrollton, Texas");
  assert.equal(isembard.stage, "Series A", "employee-band entries are not stages");
  expectSnapshot("consider-notion-companies", list);
});

function stubGetro({ searchStatus = 200, pages = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === "POST") {
      const page = JSON.parse(init.body).page;
      const body = pages ? JSON.stringify(pages[page] || { results: { companies: [], count: 0 } }) : GETRO_SEARCH;
      return new Response(body, { status: searchStatus, headers: { "content-type": "application/json" } });
    }
    return new Response(GETRO_PAGE, { status: 200, headers: { "content-type": "text/html" } });
  };
  return { fetchImpl, calls };
}

test("companies: Getro reads the id from the page then posts one search", async () => {
  const { fetchImpl, calls } = stubGetro();
  const out = await scrapeCompanies({ host: "jobs.dawncapital.com", platform: "getro", fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.deepEqual(calls.map((c) => c.url), [
    "https://jobs.dawncapital.com/companies",
    "https://api.getro.com/api/v2/collections/3063/search/companies",
  ]);
  assert.deepEqual(JSON.parse(calls[1].init.body), { hits_per_page: 1000, page: 0, query: "", filters: "" });
  assert.deepEqual(out.counts, { total: 42, fetched: 8 }, "fixture holds 8 of the board's 42");
});

test("companies: Getro pages while pages come back full, and stops on a short one", async () => {
  const one = (n) => ({ name: `Co ${n}`, domain: `co${n}.com`, slug: `co-${n}`, locations: [], active_jobs_count: 0 });
  const full = Array.from({ length: 1000 }, (_, i) => one(i + 1));
  const pages = {
    0: { results: { companies: full, count: 1001 } },
    1: { results: { companies: [one(1001)], count: 1001 } },
  };
  const { fetchImpl, calls } = stubGetro({ pages });
  const out = await scrapeCompanies({ host: "jobs.dawncapital.com", platform: "getro", fetch: fetchImpl });
  assert.deepEqual(out.counts, { total: 1001, fetched: 1001 });
  const posts = calls.filter((c) => c.init.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[1].init.body).page, 1);
});

test("companies: a failing Getro search is reported in error, never thrown", async () => {
  const { fetchImpl } = stubGetro({ searchStatus: 503 });
  const out = await scrapeCompanies({ host: "jobs.dawncapital.com", platform: "getro", fetch: fetchImpl });
  assert.deepEqual(out.companies, []);
  assert.equal(out.error, "getro: search HTTP 503");
});

test("companies: Consider reuses the jobs session and posts to search-companies", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === "POST") return new Response(CONSIDER_SEARCH, { status: 200, headers: { "content-type": "application/json" } });
    const h = new Headers();
    h.append("set-cookie", "session=abc; Path=/");
    return new Response(CONSIDER_PAGE, { status: 200, headers: h });
  };
  const out = await scrapeCompanies({ host: "jobs.notion.vc", platform: "consider", fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.equal(calls[0].url, "https://jobs.notion.vc/jobs");
  assert.equal(calls[1].url, "https://jobs.notion.vc/api-boards/search-companies");
  assert.equal(calls[1].init.headers.cookie, "session=abc");
  assert.deepEqual(JSON.parse(calls[1].init.body), { meta: { size: 200 }, board: { id: "notion-capital", isParent: true }, query: { promoteFeatured: true } });
  assert.deepEqual(out.counts, { total: 86, fetched: 6 }, "fixture holds 6 of the board's 86");
  assert.equal(calls.length, 2, "no second page requested because the fixture has no meta.sequence");
});
