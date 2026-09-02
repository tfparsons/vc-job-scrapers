// Tiny HTML helpers so we never need a parser dependency.

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
};

export function decodeEntities(text) {
  if (text == null) return text;
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

// Replace tags with a separator so adjacent text nodes do not run together.
export function stripTags(html, separator = " ") {
  return decodeEntities(String(html).replace(/<[^>]+>/g, separator))
    .replace(/\s+/g, " ")
    .trim();
}

export function clean(text) {
  if (text == null) return null;
  const out = decodeEntities(String(text)).replace(/\s+/g, " ").trim();
  return out.length ? out : null;
}
