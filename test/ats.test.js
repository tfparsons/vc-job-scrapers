import { test } from "node:test";
import assert from "node:assert/strict";
import { mapAshby, mapGreenhouse, mapLever, mapWorkable, mapTeamtailor, mapRecruitee, validSlug } from "../src/scrapers/ats-feeds.js";
import { scrapeAts, termsInTitle } from "../src/scrapers/ats.js";
import { lookupTeamtailorHost } from "../src/allowlist.js";
import { expectSnapshot, fixture } from "./helpers.js";

const NOW = new Date("2026-09-16T06:30:00Z");
const CONTRACT = ["company", "title", "location", "posted_date", "posted_relative", "seniority", "salary_raw", "remote", "link"];

function checkContract(list) {
  assert.ok(list.length > 0);
  for (const l of list) {
    assert.deepEqual(Object.keys(l).sort(), [...CONTRACT].sort());
    assert.ok(l.title, "title present");
    assert.match(l.link, /^https:\/\//, "link is absolute");
    if (l.posted_date !== null) assert.match(l.posted_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(l.remote === null || typeof l.remote === "boolean");
  }
}

test("ats: Ashby feed maps to the contract (snapshot)", () => {
  const list = mapAshby(fixture("ats-ashby.json"));
  checkContract(list);
  assert.ok(list.every((l) => /^https:\/\/jobs\.ashbyhq\.com\/metaview\//.test(l.link)));
  assert.ok(list.some((l) => l.remote === true));
  expectSnapshot("ats-ashby", list);
});

test("ats: Greenhouse feed maps to the contract, EU board urls kept (snapshot)", () => {
  const list = mapGreenhouse(fixture("ats-greenhouse.json"));
  checkContract(list);
  assert.equal(list[0].company, "Dexory");
  assert.match(list[0].link, /greenhouse\.io\/dexory\/jobs\/\d+$/);
  assert.equal(list[0].posted_date, "2025-08-08", "first_published wins over updated_at");
  expectSnapshot("ats-greenhouse", list);
});

test("ats: Lever feed maps to the contract, salary only from salaryRange (snapshot)", () => {
  const list = mapLever(fixture("ats-lever.json"));
  checkContract(list);
  assert.equal(list[0].location, "London");
  assert.equal(list[0].posted_date, "2026-08-27");
  assert.equal(list[0].remote, false, "hybrid is not remote");
  expectSnapshot("ats-lever", list);
});

test("ats: Workable widget maps to the contract with the account name as company (snapshot)", () => {
  const list = mapWorkable(fixture("ats-workable.json"));
  checkContract(list);
  assert.ok(list.every((l) => l.company === list[0].company && l.company));
  assert.match(list[0].location, /Houston, Texas, United States/);
  expectSnapshot("ats-workable", list);
});

test("ats: Teamtailor RSS maps to the contract with tt: locations (snapshot)", () => {
  const list = mapTeamtailor(fixture("ats-teamtailor.xml"));
  checkContract(list);
  assert.equal(list[0].title, "Head of Sales");
  assert.equal(list[0].location, "London, United Kingdom");
  assert.equal(list[0].posted_date, "2026-09-10");
  assert.equal(list[0].remote, false, "hybrid is not remote");
  expectSnapshot("ats-teamtailor", list);
});

test("ats: Recruitee offers map to the contract (snapshot)", () => {
  const list = mapRecruitee(fixture("ats-recruitee.json"));
  checkContract(list);
  assert.match(list[0].link, /^https:\/\/treasuryspring\.recruitee\.com\/o\//);
  expectSnapshot("ats-recruitee", list);
});

test("ats: bad feeds throw a short error, never return partial junk", () => {
  assert.throws(() => mapAshby("<html>"), /non-JSON/);
  assert.throws(() => mapGreenhouse('{"error":"not found"}'), /shape/);
  assert.throws(() => mapTeamtailor("<html>not rss</html>"), /shape/);
});

test("ats: term match is whole-word on the title", () => {
  const terms = ["gtm", "crm", "growth", "product manager"];
  assert.deepEqual(termsInTitle("GTM Engineer", terms), ["gtm"]);
  assert.deepEqual(termsInTitle("Scrum Master", terms), []);
  assert.deepEqual(termsInTitle("Senior Product Manager, Growth", terms), ["growth", "product manager"]);
  assert.deepEqual(termsInTitle("CRM & Lifecycle Lead", terms), ["crm"]);
});

test("ats: slug and host guards", () => {
  assert.equal(validSlug("metaview"), "metaview");
  assert.equal(validSlug("Qover"), "Qover");
  assert.equal(validSlug("../x"), null);
  assert.equal(validSlug(""), null);
  assert.equal(lookupTeamtailorHost("doctify.teamtailor.com"), "doctify.teamtailor.com");
  assert.equal(lookupTeamtailorHost("career.spendesk.com"), "career.spendesk.com");
  assert.equal(lookupTeamtailorHost("evil.example.com"), null);
});

function stub(bodies) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const hit = bodies.find((b) => String(url).includes(b.match));
    return new Response(hit ? hit.body : "", { status: hit ? hit.status || 200 : 404, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

const CONFIG = { terms: ["gtm", "sales", "growth", "engagement"], location_keep: null, remote_exclude: null, max_age_days: 3650 };

test("ats: one feed fetch, term filter on titles, source from the caller", async () => {
  const { fetchImpl, calls } = stub([{ match: "api.ashbyhq.com/posting-api/job-board/metaview", body: fixture("ats-ashby.json") }]);
  const out = await scrapeAts({ platform: "ashby", id: "metaview", source: "Metaview", now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.equal(calls.length, 1);
  assert.equal(out.counts.fetched, 8, "fetched is the number of open roles");
  assert.ok(out.listings.length > 0 && out.listings.length < 8, "only term matches survive");
  for (const l of out.listings) {
    assert.equal(l.company, "Metaview");
    assert.ok(l.matched_terms.length > 0);
    assert.ok(l.matched_terms.every((t) => new RegExp(`\\b${t}\\b`, "i").test(l.title)), `${l.title} matched ${l.matched_terms}`);
  }
});

test("ats: Greenhouse falls back to the EU API on 404", async () => {
  const { fetchImpl, calls } = stub([{ match: "boards-api.eu.greenhouse.io/v1/boards/dexory", body: fixture("ats-greenhouse.json") }]);
  const out = await scrapeAts({ platform: "greenhouse", id: "dexory", source: "Dexory", now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.deepEqual(calls, ["https://boards-api.greenhouse.io/v1/boards/dexory/jobs", "https://boards-api.eu.greenhouse.io/v1/boards/dexory/jobs"]);
  assert.equal(out.counts.fetched, 8);
});

test("ats: a feed that answers nothing is reported in error with no listings", async () => {
  const { fetchImpl } = stub([]);
  const out = await scrapeAts({ platform: "lever", id: "nope", source: "Nope", now: NOW, config: CONFIG, fetch: fetchImpl });
  assert.deepEqual(out.listings, []);
  assert.equal(out.error, "lever: HTTP 404");
});

test("ats: default filters drop US on-site roles and old ones", async () => {
  const { fetchImpl } = stub([{ match: "apply.workable.com/api/v1/widget/accounts/vortexa", body: fixture("ats-workable.json") }]);
  const config = { terms: ["account", "sales", "engineer", "manager"], location_keep: ["london", "united kingdom", "uk"], remote_exclude: ["united states", "usa", "us"], max_age_days: 7 };
  const out = await scrapeAts({ platform: "workable", id: "vortexa", source: "Vortexa", now: NOW, config, fetch: fetchImpl });
  assert.equal(out.error, null);
  assert.ok(!out.listings.some((l) => /Houston/.test(l.location || "")), "US on-site dropped");
  assert.ok(out.counts.after_location <= out.counts.unique);
});
