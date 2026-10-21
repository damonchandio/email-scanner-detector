import { test } from "node:test";
import assert from "node:assert/strict";
import { isLikelyScanner, parseUnsubscribe, handleUnsubscribe, renderConfirmPage } from "../src/index.js";

const browser = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36",
  "accept-language": "en-GB,en;q=0.9" };
const T = "a".repeat(32);

test("a click seconds after sending is a scan", () => {
  const v = isLikelyScanner({ sentAt: 0, now: 8_000, headers: browser });
  assert.equal(v.scanner, true);
  assert.match(v.reasons[0], /8s after sending/);
});

test("a person clicking later is not a scan", () => {
  const v = isLikelyScanner({ sentAt: 0, now: 3_600_000, headers: browser });
  assert.deepEqual([v.scanner, v.confidence, v.reasons], [false, "low", []]);
});

test("HEAD requests and bot user agents are scans", () => {
  assert.equal(isLikelyScanner({ method: "HEAD", headers: browser }).scanner, true);
  assert.equal(isLikelyScanner({ userAgent: "python-requests/2.31" }).scanner, true);
  assert.equal(isLikelyScanner({ headers: { "User-Agent": "Mozilla/5.0 HeadlessChrome/120" } }).confidence, "high");
});

test("a missing Accept-Language alone is only a weak hint", () => {
  const v = isLikelyScanner({ headers: { "user-agent": browser["user-agent"] } });
  assert.deepEqual([v.scanner, v.score], [false, 1]);
});

test("works with a Headers object", () => {
  assert.equal(isLikelyScanner({ headers: new Headers({ "user-agent": "curl/8.4" }) }).scanner, true);
});

const req = (method, body, t = T) => new Request(`https://example.com/unsubscribe?t=${t}`,
  { method, body, headers: body ? { "content-type": "application/x-www-form-urlencoded" } : {} });

test("GET never unsubscribes", async () => {
  assert.equal((await parseUnsubscribe(req("GET"))).action, "confirm-page");
  let called = false;
  const res = await handleUnsubscribe(req("GET"), { onUnsubscribe: () => (called = true) });
  assert.equal(called, false);
  assert.match(await res.text(), /name="confirm" value="1"/);
});

test("the confirm button and RFC 8058 one-click both unsubscribe", async () => {
  assert.deepEqual(await parseUnsubscribe(req("POST", "confirm=1")), { action: "unsubscribe", token: T, oneClick: false });
  assert.deepEqual(await parseUnsubscribe(req("POST", "List-Unsubscribe=One-Click")),
    { action: "unsubscribe", token: T, oneClick: true });
  const seen = [];
  const res = await handleUnsubscribe(req("POST", "confirm=1"), { onUnsubscribe: (t) => seen.push(t) > 0 });
  assert.deepEqual([res.status, seen], [200, [T]]);
});

test("bad and unknown tokens are refused", async () => {
  assert.equal((await handleUnsubscribe(req("GET", undefined, "x<y"), { onUnsubscribe: () => true })).status, 400);
  assert.equal((await handleUnsubscribe(req("POST", "confirm=1"), { onUnsubscribe: () => false })).status, 404);
});

test("the confirm page escapes what it shows", () => {
  assert.doesNotMatch(renderConfirmPage({ brand: "<script>", action: '"x' }), /<script>|"x"/);
});
