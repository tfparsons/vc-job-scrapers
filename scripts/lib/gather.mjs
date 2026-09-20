// Evidence gatherers for enrich.mjs. Plain code, no model, no paid API.
// Each gatherer takes (fields, recipe.gather) and returns an object that is
// either evidence for a model to judge, or a finished verdict
// {value, confidence, evidence} when the answer needs no judgement.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const NOT_COMPANY = /linkedin|crunchbase|pitchbook|tracxn|twitter|x\.com|facebook|instagram|youtube|wikipedia|glassdoor|indeed|techcrunch|sifted|medium\.com|github|apple\.com|google\.|bloomberg|dealroom|cbinsights|zoominfo|rocketreach|owler|f6s|wellfound|angel\.co|ycombinator|producthunt|g2\.com|capterra|gov\.uk|companieshouse|endole|beauhurst/i;

export const slug = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/\(.*?\)/g, "").replace(/\b(ltd|limited|inc|llc|gmbh|the)\b/g, "").replace(/[^a-z0-9]/g, "");
const host = (u) => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, ""); } catch { return null; } };
const clean = (s) => (s || "").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();

async function get(url, ms = 10000) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/json" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    return { status: res.status, url: res.url, text: res.status < 400 ? (await res.text()).slice(0, 400000) : "" };
  } catch (e) { return { error: e.cause?.code || e.name }; }
}

// Homepage of a domain: title, description, where it landed, raw html.
export async function homepage(domain, ms, path = "/") {
  let r = await get(`https://${domain}${path}`, ms);
  if (r.error) { const w = await get(`https://www.${domain}${path}`, ms); if (!w.error) r = w; }
  if (r.error) return { error: r.error };
  if (!r.text) return { error: `HTTP ${r.status}` };
  const t = r.text;
  const meta = (k) => clean(t.match(new RegExp(`<meta[^>]+(?:name|property)=["']${k}["'][^>]+content=["']([^"']*)`, "i"))?.[1] || t.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${k}["']`, "i"))?.[1]);
  const landed = host(r.url);
  return { title: clean(t.match(/<title[^>]*>([^<]*)/i)?.[1]).slice(0, 120), desc: (meta("description") || meta("og:description")).slice(0, 200), site: meta("og:site_name"), landed: landed !== domain ? landed : undefined, html: t };
}

const text = (p) => (p.error ? { error: p.error } : { title: p.title, desc: p.desc, site: p.site || undefined, landed: p.landed });

export const GATHERERS = {
  // What does the stored domain's homepage say? -> evidence for a model.
  async homepage(f, g) {
    const p = await homepage(f[g.domainField || "Domain"], g.timeout, g.path); // g.path e.g. "/pricing"
    return { evidence: { ...text(p), nameInPage: !p.error && slug(`${p.title} ${p.site} ${p.desc}`).includes(slug(f[g.nameField || "Company"])) }, failed: !!p.error };
  },

  // Candidate domains from name guesses and Clearbit autocomplete -> evidence for a model.
  async "domain-candidates"(f, g) {
    const name = f[g.nameField || "Company"];
    const s = slug(name);
    const c = new Map();
    const add = (d, src) => { if (d && !NOT_COMPANY.test(d)) c.set(d, [...(c.get(d) || []), src]); };
    if (s.length >= 3) for (const d of [`${s}.com`, `${s}.io`, `${s}.ai`, `${s}.co`, `${s}.co.uk`, `${s}.app`, `get${s}.com`, `${s}hq.com`, `try${s}.com`, `${s}.tech`, `${s}.health`, `${s}.energy`]) add(d, "guess");
    const cb = await get(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`);
    try { for (const x of JSON.parse(cb.text).slice(0, 3)) if (slug(x.name).includes(s) || s.includes(slug(x.name))) add(x.domain, "clearbit"); } catch { /* none */ }
    const seen = new Map();
    await Promise.all([...c.entries()].map(async ([d, src]) => {
      const p = await homepage(d, 8000);
      if (p.error || /for sale|buy this domain|parked/i.test(`${p.title} ${p.desc}`)) return;
      const dom = p.landed || d;
      if (!seen.has(dom)) seen.set(dom, { domain: dom, src: src.join("+"), title: p.title, desc: p.desc.slice(0, 140) });
    }));
    const candidates = [...seen.values()].slice(0, 4);
    return candidates.length ? { evidence: { candidates } } : { verdict: { value: null, confidence: "low", evidence: "No name-based or Clearbit candidate had a live site." } };
  },

  // Links on the company's own homepage matching a pattern (LinkedIn, X, careers...).
  // The company's site linking to a profile is direct evidence, so no model is needed.
  async "homepage-links"(f, g) {
    const p = await homepage(f[g.domainField || "Domain"], g.timeout);
    if (p.error) return { verdict: { value: null, confidence: "low", evidence: `Homepage not readable (${p.error}).` }, failed: true };
    const re = new RegExp(g.pattern, "gi");
    const skip = g.exclude ? new RegExp(g.exclude, "i") : null;
    const counts = new Map();
    for (const m of p.html.matchAll(re)) { const v = (g.prefix || "") + m[1 in m ? 1 : 0].replace(/\/+$/, "").toLowerCase(); if (!skip || !skip.test(v)) counts.set(v, (counts.get(v) || 0) + 1); }
    const found = [...counts.keys()];
    if (!found.length) return { verdict: { value: null, confidence: "low", evidence: "No matching link on the homepage." } };
    const s = slug(f[g.nameField || "Company"]);
    const dom = slug(String(f[g.domainField || "Domain"]).split(".")[0]);
    const like = found.find((v) => { const tail = slug(v.split("/").pop()); return tail && (tail.includes(s) || s.includes(tail) || tail.includes(dom) || dom.includes(tail)); });
    if (like) return { verdict: { value: like, confidence: "high", evidence: `Linked from the company homepage; handle matches the name.` } };
    return { verdict: { value: found[0], confidence: "medium", evidence: `Linked from the company homepage but the handle does not resemble the name${found.length > 1 ? ` (${found.length} different links found)` : ""}.` } };
  },
};

export async function pool(items, size, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
