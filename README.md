# email-scanner-detector

Tell email security scanners apart from real people, so your opens, clicks and unsubscribes mean something.

Zero dependencies. Works anywhere with the Fetch API: Node 18+, Deno, Bun, Cloudflare Workers and Supabase Edge Functions.

## The problem

Company mail systems don't just deliver your email. Microsoft Defender Safe Links, Mimecast, Proofpoint and similar tools open every link in it, usually within seconds of delivery, to check it isn't dangerous. Some even run the page's JavaScript.

To your server, that looks exactly like a person:

- **Fake opens and clicks.** Your dashboard says people are interested. Nobody is.
- **Fake actions.** If a link does something (build a demo, start a trial, mark a lead as hot), the scanner triggers it.
- **False unsubscribes.** If your unsubscribe link works on a plain GET, the scanner unsubscribes the person before they've even seen your email.

I hit all three running a small B2B outreach system. When I went back through the data, **11 of 11 opt-outs and about 13 of 15 "opens" were scanners**, not people. Every metric was wrong, and real prospects were being removed from the list without ever asking.

## The fix

Two simple ideas, both in this library:

1. **Time window.** A hit within about two minutes of sending is almost certainly a scanner, because no person opens an email and clicks a link that fast at scale. Log it as a `scan`, not an open.
2. **Two-step unsubscribe.** A GET never unsubscribes. It shows a page with one button. Only a POST (that button, or the RFC 8058 one-click button Gmail and Outlook show) unsubscribes. Scanners load pages; they don't press buttons.

On top of the time window, the detector checks a few other signals that are cheap and easy to justify:

| Signal | Weight | Why |
|---|---|---|
| Hit within the window after sending (default 120 s) | strong | Scanners click within seconds of delivery |
| `HEAD` request | strong | Browsers don't send HEAD when a person clicks a link |
| User agent contains a bot or scanner marker (`HeadlessChrome`, `python-requests`, `curl/`, `BingPreview`, `Mimecast`, ...) | strong | Tooling and headless browsers, not people |
| No user agent at all | medium | Real browsers always send one |
| No `Accept-Language` header | weak | Real browsers send one, many scanners don't. Never decisive on its own |

## Quick start

```bash
npm install email-scanner-detector
```

```js
import { isLikelyScanner } from "email-scanner-detector";

const verdict = isLikelyScanner({
  sentAt: contact.lastEmailedAt,   // when the email with this link went out
  method: req.method,
  headers: req.headers,            // a Headers object or a plain object
});

// { scanner: true, confidence: "high", score: 6,
//   reasons: ["opened 4s after sending (scanners click within seconds of delivery)", "user agent contains \"headlesschrome\""] }

await logEvent(verdict.scanner ? "scan" : "click");
```

### Two-step unsubscribe (Fetch API runtimes)

```js
import { handleUnsubscribe } from "email-scanner-detector";

export default {
  fetch: (request) => handleUnsubscribe(request, {
    brand: "Example Ltd",
    onUnsubscribe: async (token) => {
      const ok = await db.unsubscribeByToken(token);   // return false for an unknown token
      return ok;
    },
  }),
};
```

Links look like `https://example.com/unsubscribe?t=<random token per contact>`. Add the same URL to your `List-Unsubscribe` header together with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so mail apps can show their own one-click button.

- `GET` shows the confirm page. Nothing changes.
- `POST confirm=1` (the button) unsubscribes and shows a done page.
- `POST List-Unsubscribe=One-Click` (RFC 8058) unsubscribes and returns 200.

Lower-level helpers are exported too: `parseUnsubscribe(request)` and `renderConfirmPage({ action, brand, done })`.

Full examples: [`examples/supabase-edge-function.ts`](examples/supabase-edge-function.ts) and [`examples/express.js`](examples/express.js).

## Honest caveats

- **No detector is perfect.** Many scanners send a normal browser user agent, so the time window does most of the work. A scanner that waits longer than the window, or a very fast real person, can slip through either way.
- **The window is a trade-off.** 120 seconds worked for cold B2B email, where almost nobody clicks within two minutes. For transactional email (password resets, sign-in links) people do click fast, so use a much shorter window or don't use it at all.
- **Don't block people on this verdict.** Use it to label and count events, and to decide whether an automatic action should run. Always let a person who presses a button through.
- **The user agent list will age.** Pull requests with new markers (and evidence) are welcome.

## Why the two-step opt-out is also the safer choice for UK and EU senders

Under the UK PECR and GDPR you must give an easy way to opt out in every message and honour it promptly. The two-step flow keeps that easy (one button, plus the mail app's own one-click button) while making sure your records show what people actually chose. Removing someone because a scanner clicked a link means your suppression list no longer reflects a real decision, and real opt-outs get lost in the noise. This isn't legal advice; check what applies to your sending.

## Tests

```bash
npm test
```

## Licence

MIT, Damon Chandio, 2026.
