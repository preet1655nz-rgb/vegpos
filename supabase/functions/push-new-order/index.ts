// push-new-order: Web Push "New order #N" to every active staff device (rasoi staff app).
// Called by the orders AFTER INSERT trigger (pg_net) with header x-push-secret.
// Secrets: env VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / PUSH_WEBHOOK_SECRET when set (function secrets),
// otherwise read from Supabase Vault through public.push_config() (service_role only).
// Dead subscriptions (404/410 from the push service) are soft-revoked (revoked_at), never hard-deleted.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("STAFF_APP_URL") || "https://vegpos.vercel.app/";
const db = createClient(SB_URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

type Cfg = { pub: string; priv: string; secret: string };
let cfg: Cfg | null = null;
async function config(): Promise<Cfg> {
  if (cfg) return cfg;
  let pub = Deno.env.get("VAPID_PUBLIC_KEY") || "", priv = Deno.env.get("VAPID_PRIVATE_KEY") || "", secret = Deno.env.get("PUSH_WEBHOOK_SECRET") || "";
  if (!pub || !priv || !secret) {
    const { data, error } = await db.rpc("push_config");
    if (error) throw new Error("push_config: " + error.message);
    pub ||= data?.vapid_public || ""; priv ||= data?.vapid_private || ""; secret ||= data?.webhook_secret || "";
  }
  if (!pub || !priv || !secret) throw new Error("push not configured");
  webpush.setVapidDetails("mailto:preet1655.ps@gmail.com", pub, priv);
  return (cfg = { pub, priv, secret });
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
const money = (n: unknown) => "$" + Number(n || 0).toFixed(2);
function pickup(t: string) {
  const d = new Date(t), tz = "Pacific/Auckland";
  const day = (x: Date) => x.toLocaleDateString("en-NZ", { timeZone: tz });
  const time = d.toLocaleTimeString("en-NZ", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, " ");
  if (day(d) === day(new Date())) return "today " + time;
  if (day(d) === day(new Date(Date.now() + 864e5))) return "tomorrow " + time;
  return d.toLocaleDateString("en-NZ", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }) + " " + time;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let c: Cfg;
  try { c = await config(); } catch (e) { return json({ error: String((e as Error).message) }, 500); }
  if (!sameSecret(req.headers.get("x-push-secret") || "", c.secret)) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));

  // payload: a real order (trigger) or a test message (same secret) aimed at one endpoint
  let payload: Record<string, unknown>, only: string | null = null;
  if (body.test) {
    only = String(body.endpoint || "");
    if (!only) return json({ error: "test needs endpoint" }, 400);
    payload = { title: body.title || "Test alert", body: body.body || "Push is working", order_id: body.order_id || null, url: APP_URL, tag: "test-" + Date.now(), ts: Date.now() };
  } else {
    const id = String(body.order_id || body.record?.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "order_id required" }, 400);
    const { data: o, error } = await db.from("orders").select("id,order_no,customer_name,pickup_time,total,status").eq("id", id).maybeSingle();
    if (error || !o) return json({ error: "order not found" }, 404);
    payload = { title: `New order #${o.order_no}`, body: `${o.customer_name || "Customer"} · pickup ${pickup(o.pickup_time)} · ${money(o.total)}`,
      order_id: o.id, order_no: o.order_no, url: `${APP_URL}?order=${o.id}`, tag: "order-" + o.id, ts: Date.now() };
  }

  let q = db.from("push_subscriptions").select("id,endpoint,p256dh,auth,fail_count").is("revoked_at", null);
  if (only) q = q.eq("endpoint", only);
  const { data: subs, error: se } = await q;
  if (se) return json({ error: se.message }, 500);

  const out = { sent: 0, failed: 0, revoked: 0, results: [] as unknown[] };
  await Promise.all((subs || []).map(async (s) => {
    try {
      const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      out.sent++; out.results.push({ id: s.id, status: r.statusCode });
      await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), fail_count: 0, last_error: null }).eq("id", s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode || 0, msg = String((e as Error).message || e).slice(0, 300);
      out.results.push({ id: s.id, status: code, error: msg });
      if (code === 404 || code === 410) {
        out.revoked++;
        await db.from("push_subscriptions").update({ revoked_at: new Date().toISOString(), last_error: `${code} gone` }).eq("id", s.id);
      } else {
        out.failed++;
        await db.from("push_subscriptions").update({ fail_count: (s.fail_count || 0) + 1, last_error: `${code} ${msg}` }).eq("id", s.id);
      }
    }
  }));
  return json(out);
});
