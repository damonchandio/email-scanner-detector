// Express: tracked links that ignore scanners, and a two-step unsubscribe. Node 18+.
import express from "express";
import { isLikelyScanner, renderConfirmPage, TOKEN_RE } from "email-scanner-detector";

const app = express();
app.use(express.urlencoded({ extended: false }));

// Your own storage. Replace these with database calls.
const contacts = new Map();   // token -> { email, lastEmailedAt, unsubscribed }
const events = [];

// Click tracking: count only clicks a person made.
app.all("/r/:token", (req, res) => {
  const c = contacts.get(req.params.token);
  const v = isLikelyScanner({ sentAt: c?.lastEmailedAt, method: req.method, headers: req.headers });
  events.push({ token: req.params.token, type: v.scanner ? "scan" : "click", reasons: v.reasons, at: Date.now() });
  res.redirect(302, "https://example.com/landing");
});

// GET shows a confirm page; only a POST unsubscribes (the button, or RFC 8058 one-click).
app.get("/unsubscribe", (req, res) => {
  if (!TOKEN_RE.test(String(req.query.t ?? ""))) return res.status(400).send("This link isn't valid.");
  res.set("cache-control", "no-store").type("html").send(renderConfirmPage({ action: req.originalUrl, brand: "Example Ltd" }));
});

app.post("/unsubscribe", (req, res) => {
  const c = contacts.get(String(req.query.t ?? ""));
  const oneClick = req.body["List-Unsubscribe"] === "One-Click";
  if (!c || (req.body.confirm !== "1" && !oneClick)) return res.status(400).send("This link isn't valid.");
  c.unsubscribed = true;
  if (oneClick) return res.sendStatus(200);
  res.type("html").send(renderConfirmPage({ brand: "Example Ltd", done: true }));
});

app.listen(3000, () => console.log("http://localhost:3000"));
