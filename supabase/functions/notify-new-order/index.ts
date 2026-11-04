// notify-new-order: sends a WhatsApp Cloud API *template* message to the staff/owner WhatsApp number
// (public.settings.staff_whatsapp) when a new order is inserted. Staff-side only: never messages customers.
//
// NOT DEPLOYED / NOT ENABLED. See supabase/functions/notify-new-order/README.md for the switch-on steps.
//
// Called by the pg_net trigger in supabase/migrations/20261104070000_v9_whatsapp_cloud_notify_PREPARED.sql
// with   POST { "order_id": "<uuid>" }   and header   x-notify-secret: <NOTIFY_WEBHOOK_SECRET>.
// Also accepts a Supabase Database Webhook payload ({ type: "INSERT", table: "orders", record: {...} }).
//
// Function secrets (supabase secrets set ...):
//   WHATSAPP_TOKEN            permanent System User access token (whatsapp_business_messaging)
//   WHATSAPP_PHONE_NUMBER_ID  the sending number's Phone Number ID from WhatsApp Manager
//   WHATSAPP_TEMPLATE_NAME    approved template name (default "new_order")
//   WHATSAPP_TEMPLATE_LANG    template language code (default "en")
//   NOTIFY_WEBHOOK_SECRET     shared secret, same value as Vault secret "notify_new_order_secret"
//   NOTIFY_ONLY_CUSTOMER_APP  optional "true" = only alert for Customer-app orders (default: all new orders)
//   WHATSAPP_DRY_RUN          optional "true" = build + log the request but do not call Meta
// Provided automatically by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const GRAPH = "https://graph.facebook.com/v21.0";
const TZ = "Pacific/Auckland";
const env = (k: string, d = "") => (Deno.env.get(k) ?? d).trim();

// Same rules as the staff app: NZ default (021… -> 6421…), +CC kept, 00CC -> CC
function waNumber(p: string | null): string | null {
  const raw = String(p ?? "").trim();
  const d = raw.replace(/[^0-9]/g, "");
  if (d.length < 7) return null;
  if (d.startsWith("00")) return d.slice(2);
  if (raw.startsWith("+")) return d;
  if (d.startsWith("64") && d.length >= 10) return d;
  if (d.startsWith("0")) return "64" + d.replace(/^0+/, "");
  return "64" + d;
}
// Template parameters may not contain newlines, tabs or 4+ consecutive spaces; keep each short.
const clean = (s: unknown, max = 200) => {
  const t = String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (t.length > max ? t.slice(0, max - 1) + "…" : t) || "-";
};
const money = (n: unknown) => new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(Number(n) || 0);
const pickup = (iso: string) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-NZ", { timeZone: TZ, weekday: "short" });
  const dm = d.toLocaleDateString("en-NZ", { timeZone: TZ, day: "numeric", month: "short" });
  const tm = d.toLocaleTimeString("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.?m\.?/i, " $1m").toLowerCase();
  return `${day} ${dm}, ${tm}`;
};
type Item = { name?: string; variant?: string; qty?: number; price?: number };
const itemsSummary = (items: Item[]) =>
  (items ?? []).map((i) => `${i.qty ?? 1}x ${i.name ?? "item"}${i.variant ? ` (${i.variant})` : ""}`).join(", ");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const secret = env("NOTIFY_WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-notify-secret") !== secret) return json(401, { error: "unauthorised" });

  let payload: any;
  try { payload = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const orderId: string | undefined = payload?.order_id ?? payload?.record?.id;
  if (!orderId) return json(400, { error: "order_id missing" });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const [{ data: o, error: oe }, { data: st, error: se }] = await Promise.all([
    db.from("orders").select("id,order_no,customer_name,customer_phone,pickup_time,items,total,created_by,status").eq("id", orderId).maybeSingle(),
    db.from("settings").select("staff_whatsapp").eq("id", 1).maybeSingle(),
  ]);
  if (oe || se) return json(500, { error: (oe ?? se)!.message });
  if (!o) return json(404, { error: "order not found" });
  if (env("NOTIFY_ONLY_CUSTOMER_APP") === "true" && o.created_by !== "customer-app") return json(200, { skipped: "not a customer-app order" });

  const to = waNumber(st?.staff_whatsapp ?? null);
  const log = (status: string, detail: unknown, msgId: string | null = null) =>
    db.from("notification_log").insert({ order_id: o.id, channel: "whatsapp_cloud", recipient: to, status, provider_message_id: msgId, detail });
  if (!to) { await log("skipped", { reason: "settings.staff_whatsapp is empty" }); return json(200, { skipped: "no staff_whatsapp" }); }

  // de-duplicate: one successful send per order
  const { data: prev } = await db.from("notification_log").select("id").eq("order_id", o.id).eq("channel", "whatsapp_cloud").eq("status", "sent").limit(1);
  if (prev?.length) return json(200, { skipped: "already sent" });

  const params = [
    `#${o.order_no}`,                                   // {{1}} order #
    clean(o.customer_name, 60),                          // {{2}} name
    clean(o.customer_phone || "not given", 30),          // {{3}} phone
    clean(pickup(o.pickup_time), 40),                    // {{4}} pickup time (NZ)
    clean(itemsSummary(o.items as Item[]), 500),         // {{5}} items summary
    money(o.total),                                      // {{6}} total
  ];
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: env("WHATSAPP_TEMPLATE_NAME", "new_order"),
      language: { code: env("WHATSAPP_TEMPLATE_LANG", "en") },
      components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
    },
  };

  if (env("WHATSAPP_DRY_RUN") === "true") { await log("dry_run", body); return json(200, { dry_run: true, body }); }
  const token = env("WHATSAPP_TOKEN"), pnid = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !pnid) { await log("error", { reason: "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set" }); return json(500, { error: "whatsapp secrets missing" }); }

  const r = await fetch(`${GRAPH}/${pnid}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await r.json().catch(() => ({}));
  const msgId = res?.messages?.[0]?.id ?? null;
  await log(r.ok ? "sent" : "error", { http: r.status, response: res }, msgId);
  return json(r.ok ? 200 : 502, { ok: r.ok, http: r.status, message_id: msgId, error: r.ok ? undefined : res?.error });
});
