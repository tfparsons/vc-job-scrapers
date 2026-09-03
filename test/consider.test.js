import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConsiderSession, mapConsiderJobs, scrapeConsider } from "../src/scrapers/consider.js";
import { expectSnapshot, fixture, NOW } from "./helpers.js";
const PAGE = fixture("consider-notion-page.html");
const SEARCH = fixture("consider-notion-search.json");

test("consider: session token and board id are read from the page", () => {
  const { csrfToken, board } = parseConsiderSession(PAGE);
  assert.match(csrfToken, /^[A-Za-z0-9_-]{20,}$/);
  assert.deepEqual(board, { id: "notion-capital", isParent: true });
  assert.deepEqual(parseConsiderSession("<html>nothing</html>"), { csrfToken: null, board: null });
});

test("consider: search response maps to the contract (snapshot)", () => {
  const json = JSON.parse(SEARCH);
  const listings = mapConsiderJobs(json);
  assert.equal(listings.length, json.jobs.length);
  assert.ok(listings.length > 0);
  for (const l of listings) {
    assert.match(l.link, /^https?:\/\//, "link is absolute");
    assert.doesNotMatch(l.link, /utm_/, "link must be the canonical url, not applyUrl");
    assert.equal(l.salary_raw, null, "salary is never inferred from Consider's salary object");
    assert.equal(l.posted_relative, null);
    if (l.posted_date !== null) assert.match(l.posted_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(typeof l.remote === "boolean" || l.remote === null);
  }
  expectSnapshot("consider-notion-search", listings);
});

// A fetch stub that plays the two-step and records what it was sent.
function stubFetch({ postStatus = 200, postBody = SEARCH, redirectFirst = false, secondPage = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(url);
    if (init.method === "POST") {
      const isPage2 = init.body && JSON.parse(init.body).meta.sequence;
      const body = isPage2 ? JSON.stringify(secondPage || { total: 0, jobs: [], meta: {} }) : postBody;
      return new Response(body, { status: postStatus, headers: { "content-type": postStatus === 200 ? "application/json" : "text/html" } });
    }
    if (redirectFirst && u.pathname === "/jobs") {
      const h = new Headers();
      h.append("set-cookie", "session=first; Path=/; HttpOnly");
      h.append("location", "/jobs/");
      return new Response("", { status: 302, headers: h });
    }
    const h = new Headers();
    h.append("set-cookie", "session=abc; Path=/; HttpOnly; Expires=Wed, 09 Sep 2026 12:45:10 GMT");
    h.append("set-cookie", "session.sig=sig1; Path=/");
    h.append("set-cookie", "AWSALBAPP-0=alb; Path=/");
    h.append("set-cookie", "AWSALBAPP-1=_remove_; Path=/");
    return new Response(PAGE, { status: 200, headers: h });
  };
  return { fetchImpl, calls };
}

const CONFIG = { terms: ["gtm", "growth"], location_keep: null, max_age_days: 3650 };

test("consider: two-step carries token and cookies, unions terms, counts add up", async () => {
  const { fetchImpl, calls } = stubFetch();
  const out = await scrapeConsider({ host: "jobs.notion.vc", now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.equal(calls.length, 3, "one GET + one POST per term");
  assert.equal(calls[0].url, "https://jobs.notion.vc/jobs");
  assert.equal(calls[0].init.redirect, "manual");
  const post = calls[1];
  assert.equal(post.url, "https://jobs.notion.vc/api-boards/search-jobs");
  assert.equal(post.init.headers["x-csrf-token"], parseConsiderSession(PAGE).csrfToken);
  assert.equal(post.init.headers.cookie, "session=abc; session.sig=sig1; AWSALBAPP-0=alb");
  assert.equal(post.init.headers.origin, "https://jobs.notion.vc");
  assert.equal(post.init.headers.referer, "https://jobs.notion.vc/jobs");
  assert.match(post.init.headers["user-agent"], /^VC-Job-Scrapers\/2\.0/);
  const body = JSON.parse(post.init.body);
  assert.deepEqual(body, { meta: { size: 100 }, board: { id: "notion-capital", isParent: true }, query: { promoteFeatured: true, titlePrefix: "gtm" } });
  const n = JSON.parse(SEARCH).jobs.length;
  assert.deepEqual(out.counts, { fetched: 2 * n, unique: n, after_location: n, after_recency: n });
  assert.deepEqual(out.listings[0].matched_terms, ["gtm", "growth"]);
});

test("consider: a redirect on the board page keeps cookies from both hops", async () => {
  const { fetchImpl, calls } = stubFetch({ redirectFirst: true });
  const out = await scrapeConsider({ host: "jobs.notion.vc", now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.equal(calls[1].url, "https://jobs.notion.vc/jobs/");
  assert.equal(calls[2].init.headers.cookie, "session=abc; session.sig=sig1; AWSALBAPP-0=alb");
});

test("consider: 412 surfaces as an error with empty listings", async () => {
  const { fetchImpl } = stubFetch({ postStatus: 412, postBody: '{"error":"INVALID_CSRF"}' });
  const out = await scrapeConsider({ host: "jobs.notion.vc", now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.deepEqual(out.listings, []);
  assert.equal(out.error, "consider: 412 INVALID_CSRF");
});

test("consider: an HTML 404 is reported as non-JSON", async () => {
  const { fetchImpl } = stubFetch({ postStatus: 404, postBody: "<html>Not found</html>" });
  const out = await scrapeConsider({ host: "jobs.notion.vc", now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.deepEqual(out.listings, []);
  assert.equal(out.error, "consider: non-JSON response (HTTP 404)");
});

test("consider: default filters keep only London/UK/remote and recent", async () => {
  const { fetchImpl } = stubFetch();
  const config = { terms: ["gtm"], location_keep: ["london", "united kingdom", "uk", "emea", "europe"], remote_exclude: ["united states", "usa", "us"], max_age_days: 7 };
  const out = await scrapeConsider({ host: "jobs.notion.vc", now: NOW, config, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.ok(out.counts.after_location <= out.counts.unique);
  assert.ok(out.counts.after_recency <= out.counts.after_location);
  for (const l of out.listings) {
    const named = l.location === null || /london|united kingdom|\buk\b|emea|europe/i.test(l.location);
    const remoteOk = (l.remote === true || /remote/i.test(l.location)) && !/united states|usa|\bus\b/i.test(l.location);
    assert.ok(named || remoteOk, `unexpected location kept: ${l.location}`);
  }
});

test("consider: pages on while the board has more and the last job is still recent", async () => {
  const first = JSON.parse(SEARCH);
  const page1 = { ...first, total: first.jobs.length + 2, meta: { size: 100, sequence: "cursor-1" } };
  const extra = first.jobs.slice(0, 2).map((j, i) => ({ ...j, url: `https://example.com/page2/${i}` }));
  const page2 = { total: page1.total, jobs: extra, meta: { size: 100 } };
  const { fetchImpl, calls } = stubFetch({ postBody: JSON.stringify(page1), secondPage: page2 });
  const out = await scrapeConsider({ host: "jobs.notion.vc", now: NOW, config: { ...CONFIG, terms: ["gtm"] }, fetch: fetchImpl });
  assert.equal(out.error, null);
  const posts = calls.filter((c) => c.init.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[1].init.body).meta.sequence, "cursor-1");
  assert.equal(out.counts.unique, first.jobs.length + 2);
});

test("consider: does not page when the last job is already outside the window", async () => {
  const first = JSON.parse(SEARCH);
  const page1 = { ...first, total: 500, meta: { size: 100, sequence: "cursor-1" } };
  const { fetchImpl, calls } = stubFetch({ postBody: JSON.stringify(page1) });
  const config = { terms: ["gtm"], location_keep: null, max_age_days: 1 };
  const now = new Date("2026-12-01T00:00:00Z"); // every fixture job is months old
  await scrapeConsider({ host: "jobs.notion.vc", now, config, fetch: fetchImpl });
  assert.equal(calls.filter((c) => c.init.method === "POST").length, 1);
});

test("consider: a board hosted on consider.com uses the board path and the id from the query", async () => {
  const pageWithoutBoard = PAGE.replace(/"board":\{"id":"[^"]+","isParent":(?:true|false)\}/, '"fixedBoard":false');
  assert.equal(parseConsiderSession(pageWithoutBoard).board, null, "fixture stripped of its board object");
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === "POST") return new Response(SEARCH, { status: 200, headers: { "content-type": "application/json" } });
    const h = new Headers();
    h.append("set-cookie", "session=abc; Path=/");
    return new Response(pageWithoutBoard, { status: 200, headers: h });
  };
  const out = await scrapeConsider({ host: "consider.com", board: "point72-ventures", now: NOW, config: { ...CONFIG, terms: ["gtm"] }, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.equal(calls[0].url, "https://consider.com/boards/vc/point72-ventures/jobs");
  assert.equal(calls[1].url, "https://consider.com/api-boards/search-jobs");
  assert.equal(calls[1].init.headers.referer, "https://consider.com/boards/vc/point72-ventures/jobs");
  assert.deepEqual(JSON.parse(calls[1].init.body).board, { id: "point72-ventures", isParent: true });
});
