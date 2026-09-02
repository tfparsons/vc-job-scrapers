// Turn a board's relative age ("1 day", "4 days", "3 hours", "2 weeks") into
// an ISO date against `now`. Anything coarser than weeks ("1 month", "2 years")
// or unparseable returns null; callers keep the raw text in `posted_relative`.

const UNIT_MS = {
  minute: 60e3,
  hour: 3600e3,
  day: 86400e3,
  week: 7 * 86400e3,
};

export function relativeToDate(text, now) {
  if (!text || typeof text !== "string") return null;
  const m = text.trim().toLowerCase().match(/^(?:posted\s*:?\s*)?(?:about\s+)?(\d+|an?)\s+(minute|hour|day|week|month|year)s?(?:\s+ago)?$/);
  if (!m) return null;
  const n = m[1] === "a" || m[1] === "an" ? 1 : Number.parseInt(m[1], 10);
  const ms = UNIT_MS[m[2]];
  if (!ms || !Number.isFinite(n)) return null;
  return new Date(now.getTime() - n * ms).toISOString().slice(0, 10);
}

// True when the relative text says the listing is a month or more old.
export function isStaleRelative(text) {
  return typeof text === "string" && /\b(month|year)s?\b/i.test(text);
}
