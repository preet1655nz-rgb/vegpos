// whatsapp-webhook: two-way WhatsApp for the rasoi staff app.
// When the STAFF WhatsApp number (public.settings.staff_whatsapp) taps the "Accept" quick-reply button on the
// new_order message, or types "accept" / "accepted" (any case, optionally "accept 31"), the order becomes Accepted.
// Realtime then updates every open staff app. Customers are never messaged.
//
// NOT DEPLOYED / NOT ENABLED. See ./README.md for the switch-on steps.
//
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…   Meta webhook verification (WHATSAPP_VERIFY_TOKEN)
//   POST (Meta "messages" webhook)                                  validated with X-Hub-Signature-256 (WHATSAPP_APP_SECRET)
//
// Which order? (first match wins)
//   1. quick-reply button payload "ACCEPT:<order uuid>" (sent by notify-new-order)
//   2. an order number in the text, e.g. "accept 31" / "accepted #31"
//   3. the replied-to message: context.id → notification_log.provider_message_id → order
//   4. the latest order still waiting (status pending)
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (same as notify-new-order), WHATSAPP_APP_SECRET,
//          WHATSAPP_VERIFY_TOKEN, optional WHATSAPP_DRY_RUN=true (no replies sent). Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Deploy with --no-verify-jwt (Meta cannot send a Supabase JWT; the HMAC signature is the authentication).
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const GRAPH = "https://graph.facebook.com/v21.0";
const env = (k: string, d = "") => (Deno.env.get(k) ?? d).trim();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Same rules as the staff app / notify-new-order: NZ default (021… → 6421…), +CC kept, 00CC → CC
export function waNumber(p: string | null): string | null {
  const raw = String(p ?? "").trim(), d = raw.replace(/[^0-9]/g, "");
  if (d.length < 7) return null;
  if (d.startsWith("00")) return d.slice(2);
  if (raw.startsWith("+")) return d;
  if (d.startsWith("64") && d.length >= 10) return d;
  if (d.startsWith("0")) return "64" + d.replace(/^0+/, "");
  return "64" + d;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function validSignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const got = header.slice(7).toLowerCase();
  if (got.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Intent = { accept: boolean; orderId?: string; orderNo?: number; via: string };
// deno-lint-ignore no-explicit-any
export function parseIntent(m: any): Intent {
  let payload = "", text = "";
  if (m?.type === "button") { payload = m.button?.payload ?? ""; text = m.button?.text ?? ""; }
  else if (m?.type === "interactive") { payload = m.interactive?.button_reply?.id ?? ""; text = m.interactive?.button_reply?.title ?? ""; }
  else if (m?.type === "text") text = m.text?.body ?? "";
  const pm = payload.match(/^ACCEPT:(.+)$/i);
  if (pm && UUID.test(pm[1].trim())) return { accept: true, orderId: pm[1].trim(), via: "button_payload" };
  const tm = text.trim().match(/^accept(?:ed)?\b[\s:,.!-]*(?:order\s*)?#?\s*(\d{1,7})?\b[\s.!✓✅👍]*$/iu);
  if (tm) return { accept: true, orderNo: tm[1] ? Number(tm[1]) : undefined, via: m?.type === "text" ? "text" : "button_text" };
  if (/^accept$/i.test(payload.trim())) return { accept: true, via: "button_payload" };
  return { accept: false, via: "none" };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && !!env("WHATSAPP_VERIFY_TOKEN") &&
      url.searchParams.get("hub.verify_token") === env("WHATSAPP_VERIFY_TOKEN");
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } })
      : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return json(405, { error: "GET/POST only" });

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256"), env("WHATSAPP_APP_SECRET")))) return json(401, { error: "bad signature" });
  // deno-lint-ignore no-explicit-any
  let body: any; try { body = JSON.parse(raw); } catch { return json(400, { error: "bad json" }); }

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: st } = await db.from("settings").select("staff_whatsapp").eq("id", 1).maybeSingle();
  const staff = waNumber(st?.staff_whatsapp ?? null);
  const results: unknown[] = [];

  // deno-lint-ignore no-explicit-any
  const log = (row: Record<string, any>) => db.from("notification_log").insert({ channel: "whatsapp_cloud", ...row });
  const reply = async (to: string, inReplyTo: string, text: string, orderId: string | null) => {
    const msg = { messaging_product: "whatsapp", to, type: "text", context: { message_id: inReplyTo }, text: { body: text } };
    if (env("WHATSAPP_DRY_RUN") === "true") { await log({ order_id: orderId, recipient: to, status: "dry_run", detail: { reply: msg } }); return; }
    const token = env("WHATSAPP_TOKEN"), pnid = env("WHATSAPP_PHONE_NUMBER_ID");
    if (!token || !pnid) { await log({ order_id: orderId, recipient: to, status: "error", detail: { reason: "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set", reply: text } }); return; }
    const r = await fetch(`${GRAPH}/${pnid}/messages`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(msg) });
    const res = await r.json().catch(() => ({}));
    await log({ order_id: orderId, recipient: to, status: r.ok ? "sent" : "error", provider_message_id: res?.messages?.[0]?.id ?? null, detail: { reply: text, http: r.status, response: r.ok ? undefined : res } });
  };

  for (const entry of body?.entry ?? []) for (const ch of entry?.changes ?? []) {
    if (ch?.field !== "messages") continue;
    for (const m of ch?.value?.messages ?? []) {
      const from = String(m?.from ?? ""), wamid = String(m?.id ?? "");
      const intent = parseIntent(m);
      const isStaff = !!staff && from === staff;
      // idempotency: Meta may deliver the same message more than once — the unique index rejects the 2nd insert
      const { error: dup } = await log({ recipient: from, status: isStaff && intent.accept ? "received" : "ignored", provider_message_id: wamid || null,
        detail: { type: m?.type, text: m?.text?.body ?? m?.button?.text ?? m?.interactive?.button_reply?.title ?? null, payload: m?.button?.payload ?? null, context: m?.context?.id ?? null, intent } });
      if (dup) { results.push({ wamid, skipped: "duplicate" }); continue; }
      if (!isStaff) { results.push({ wamid, ignored: staff ? "not the staff number" : "staff_whatsapp not set" }); continue; }  // never reply to other numbers
      if (!intent.accept) { results.push({ wamid, ignored: "not an accept message" }); continue; }

      // resolve the order
      let orderId: string | null = intent.orderId ?? null, how = intent.via;
      if (!orderId && intent.orderNo) {
        const { data } = await db.from("orders").select("id").eq("order_no", intent.orderNo).maybeSingle(); orderId = data?.id ?? null; how = "order_no_in_text";
        if (!orderId) { await reply(from, wamid, `Order #${intent.orderNo} not found.`, null); results.push({ wamid, error: "order_no not found" }); continue; }
      }
      if (!orderId && m?.context?.id) {
        const { data } = await db.from("notification_log").select("order_id").eq("provider_message_id", m.context.id).not("order_id", "is", null).limit(1).maybeSingle();
        orderId = data?.order_id ?? null; if (orderId) how = "context_id";
      }
      if (!orderId) {
        const { data } = await db.from("orders").select("id").eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
        orderId = data?.id ?? null; how = "latest_pending";
      }
      if (!orderId) { await reply(from, wamid, "No new orders are waiting to be accepted.", null); results.push({ wamid, result: "nothing pending" }); continue; }

      const { data: r, error } = await db.rpc("wa_accept_order", { p_order_id: orderId, p_from: from, p_inbound_wamid: wamid });
      if (error) { await log({ order_id: orderId, recipient: from, status: "error", detail: { rpc: error.message } }); results.push({ wamid, error: error.message }); continue; }
      await db.from("notification_log").update({ order_id: orderId }).eq("provider_message_id", wamid).eq("status", "received");
      const n = r?.order_no;
      const text = r?.result === "accepted" ? `Order #${n} accepted ✓`
        : r?.result === "already" ? `Order #${n} is already ${r.status === "completed" ? "completed" : "accepted"} ✓`
        : r?.result === "cancelled" ? `Order #${n} was cancelled, so it was not accepted.`
        : r?.result === "not_found" ? "That order was not found." : "Only the staff WhatsApp number can accept orders.";
      await reply(from, wamid, text, orderId);
      results.push({ wamid, order_id: orderId, how, ...r });
    }
  }
  return json(200, { ok: true, results });  // always 200 for a valid signature so Meta does not retry
});
