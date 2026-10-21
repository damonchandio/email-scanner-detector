// Supabase Edge Function: a two-step unsubscribe endpoint plus scanner-aware click logging.
// Deploy as `unsubscribe` and put https://<your-project>.supabase.co/functions/v1/unsubscribe?t=<token> in your emails,
// with the same URL in the List-Unsubscribe header and "List-Unsubscribe-Post: List-Unsubscribe=One-Click".
//
// Tables assumed (rename to suit):
//   contacts(id, email, unsubscribe_token, last_emailed_at, status)
//   suppression(value primary key, reason)
//   link_events(contact_id, type, reasons)
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleUnsubscribe, isLikelyScanner } from "npm:email-scanner-detector";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const { data: c } = await db.from("contacts").select("id,email,last_emailed_at").eq("unsubscribe_token", token)
    .maybeSingle();

  // Log every hit, but label scanner hits so they never count as engagement.
  if (c) {
    const v = isLikelyScanner({ sentAt: c.last_emailed_at, method: req.method, headers: req.headers });
    await db.from("link_events").insert({ contact_id: c.id, type: v.scanner ? "scan" : "visit", reasons: v.reasons });
  }

  return handleUnsubscribe(req, {
    brand: "Example Ltd",
    onUnsubscribe: async () => {
      if (!c) return false;
      await db.from("suppression").upsert({ value: c.email.toLowerCase(), reason: "unsubscribe link" },
        { onConflict: "value" });
      await db.from("contacts").update({ status: "unsubscribed" }).eq("id", c.id);
      return true;
    },
  });
});
