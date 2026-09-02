// Workers fetch keeps no cookie jar. Read every Set-Cookie from a response and
// rebuild a Cookie header for the next request.

// Pass an existing `jar` to merge a second response's cookies into it.
export function parseSetCookies(setCookieLines, jar = new Map()) {
  for (const line of setCookieLines || []) {
    const pair = String(line).split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    // AWS ALB uses the value `_remove_` (with a past Expires) to delete a cookie.
    if (!value || value === "_remove_") jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}

export function cookieHeaderFrom(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

// Never use headers.get("set-cookie"): it joins cookies with ", " and the
// Expires attribute itself contains a comma.
export function setCookiesFromResponse(response) {
  const h = response.headers;
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const raw = h.get("set-cookie");
  return raw ? [raw] : [];
}
