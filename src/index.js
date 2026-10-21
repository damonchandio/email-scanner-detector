// email-scanner-detector: tell email security scanners apart from people.
// Zero dependencies. Runs anywhere with the Fetch API (Node 18+, Deno, Bun, Cloudflare Workers, Supabase Edge).

export const DEFAULT_WINDOW_MS = 120_000;

// Markers seen in scanner and bot traffic. Many scanners send a normal browser user agent, so a clean user
// agent proves nothing; a match here is a strong hint.
export const SCANNER_UA_MARKERS = [
  "headlesschrome", "phantomjs", "python-requests", "python-urllib", "aiohttp", "curl/", "wget/",
  "go-http-client", "java/", "okhttp", "libwww-perl", "bingpreview", "barracuda", "mimecast", "proofpoint",
  "symantec", "trendmicro", "forcepoint", "safelinks",
];

const header = (headers, name) => {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) ?? "";
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const v = key ? headers[key] : "";
  return Array.isArray(v) ? v.join(",") : (v ?? "");
};

/**
 * Was this link hit made by an email security scanner rather than a person?
 * @param {object} hit
 * @param {Date|number|string} [hit.sentAt]  when the email carrying this link was sent
 * @param {Date|number|string} [hit.now]     defaults to now
 * @param {string} [hit.method]              HTTP method
 * @param {string} [hit.userAgent]           falls back to the user-agent header
 * @param {Headers|object} [hit.headers]
 * @param {number} [hit.windowMs]            seconds after sending that count as a scan (default 120 s)
 */
export function isLikelyScanner(hit = {}) {
  const reasons = [];
  let score = 0;
  const windowMs = hit.windowMs ?? DEFAULT_WINDOW_MS;
  if (hit.sentAt != null) {
    const age = new Date(hit.now ?? Date.now()).getTime() - new Date(hit.sentAt).getTime();
    if (age >= 0 && age < windowMs) {
      score += 3;
      reasons.push(`opened ${Math.round(age / 1000)}s after sending (scanners click within seconds of delivery)`);
    }
  }
  const method = (hit.method ?? "GET").toUpperCase();
  if (method === "HEAD") {
    score += 3;
    reasons.push("HEAD request (browsers don't send these when a person clicks a link)");
  }
  const ua = (hit.userAgent ?? header(hit.headers, "user-agent")).toLowerCase();
  if (!ua) {
    score += 2;
    reasons.push("no user agent");
  } else {
    const m = SCANNER_UA_MARKERS.find((x) => ua.includes(x));
    if (m) {
      score += 3;
      reasons.push(`user agent contains "${m}"`);
    }
  }
  if (hit.headers && !header(hit.headers, "accept-language")) {
    score += 1;
    reasons.push("no Accept-Language header (real browsers send one)");
  }
  return { scanner: score >= 3, confidence: score >= 4 ? "high" : score >= 3 ? "medium" : "low", score, reasons };
}

// ---- two-step unsubscribe -------------------------------------------------------------------------
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** HTML page with one button that POSTs confirm=1 back to `action`. Scanners load it; only people press it. */
export function renderConfirmPage({ action, brand = "us", done = false } = {}) {
  const body = done
    ? `<h1>You're unsubscribed</h1><p>You won't get any more emails from ${esc(brand)}.</p>`
    : `<h1>Unsubscribe</h1><p>Stop emails from ${esc(brand)}?</p>
<form method="post" action="${esc(action)}"><input type="hidden" name="confirm" value="1">
<button type="submit">Yes, unsubscribe me</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Unsubscribe</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.6rem 1.2rem;cursor:pointer}</style>
</head><body>${body}</body></html>`;
}

/**
 * What an unsubscribe request asks for.
 *  GET                          -> "confirm-page" (never unsubscribes: scanners send GETs)
 *  POST confirm=1               -> "unsubscribe"  (the person pressed the button)
 *  POST List-Unsubscribe=One-Click -> "unsubscribe" (RFC 8058 one-click from Gmail, Outlook and others)
 * @param {Request} request
 * @returns {Promise<{action: "confirm-page"|"unsubscribe"|"invalid", token: string, oneClick?: boolean}>}
 */
export async function parseUnsubscribe(request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  if (!TOKEN_RE.test(token)) return { action: "invalid", token };
  if (request.method === "GET" || request.method === "HEAD") return { action: "confirm-page", token };
  if (request.method !== "POST") return { action: "invalid", token };
  const form = new URLSearchParams(await request.text().catch(() => ""));
  if (form.get("confirm") === "1") return { action: "unsubscribe", token, oneClick: false };
  if (form.get("List-Unsubscribe") === "One-Click") return { action: "unsubscribe", token, oneClick: true };
  return { action: "confirm-page", token };
}

/**
 * A complete unsubscribe endpoint for Fetch API runtimes.
 * @param {Request} request
 * @param {{onUnsubscribe: (token: string) => Promise<boolean>|boolean, brand?: string}} opts
 *   onUnsubscribe returns false when the token is unknown.
 */
export async function handleUnsubscribe(request, { onUnsubscribe, brand } = {}) {
  const html = (body, status = 200) => new Response(body, { status, headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  const r = await parseUnsubscribe(request);
  if (r.action === "invalid") return html("<p>This unsubscribe link isn't valid. Reply to the email instead.</p>", 400);
  if (r.action === "confirm-page") return html(renderConfirmPage({ action: request.url, brand }));
  const ok = await onUnsubscribe(r.token);
  if (!ok) return html("<p>This unsubscribe link isn't valid. Reply to the email instead.</p>", 404);
  return r.oneClick ? new Response(null, { status: 200 }) : html(renderConfirmPage({ brand, done: true }));
}
