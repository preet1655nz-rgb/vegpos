# whatsapp-webhook (prepared, NOT deployed, NOT enabled)

Two-way WhatsApp for the staff app. A staff member taps the **Accept** button on the new-order WhatsApp alert or replies
**"Accepted"**, and the order becomes **Accepted**. Every open staff app updates through Realtime. Customers are never messaged.

```
Meta (messages webhook) ──POST, X-Hub-Signature-256──▶ whatsapp-webhook
   ├─ HMAC-SHA256(raw body, WHATSAPP_APP_SECRET) must match       → else 401
   ├─ sender must be Settings → Staff WhatsApp (staff_whatsapp)    → else ignored (no reply)
   ├─ "Accept" button / "accept" / "accepted" / "accept 31" (any case)
   ├─ order = button payload ACCEPT:<id> → number in text → context.id → notification_log.provider_message_id → newest pending
   ├─ rpc wa_accept_order (service role only; re-checks the staff number; pending → accepted; audit_log note "Accepted via WhatsApp…")
   └─ replies "Order #31 accepted ✓" (or "already accepted" / "was cancelled" / "No new orders are waiting")
```
Every inbound message is logged in `public.notification_log` (`received` / `ignored`). The inbound wamid is unique, so Meta retries are processed once.

Files
- `index.ts`: the function (GET verification + POST handler)
- `../../migrations/20261104090000_v11_whatsapp_two_way_PREPARED.sql`: log statuses, idempotency index, `wa_accept_order()` (additive; needs v9 first)
- `../../config.whatsapp-webhook.toml`: `verify_jwt = false`
- `../notify-new-order/template_new_order.txt`: template with the **Accept** quick-reply button

## Switch-on (after notify-new-order is live; see its README)
1. **Template:** submit or edit `new_order` with the Accept quick-reply button (see `template_new_order.txt`). Wait for *Approved*.
2. **Apply** `20261104070000_v9_…PREPARED.sql` (if not yet applied), then `20261104090000_v11_…PREPARED.sql`.
3. **Secrets:** `supabase secrets set WHATSAPP_APP_SECRET=<Meta app → App settings → Basic → App secret> WHATSAPP_VERIFY_TOKEN=<any long random string you choose> WHATSAPP_DRY_RUN=true --project-ref sjjesqyqaikivonjuxfs`
   (`WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are shared with notify-new-order.)
4. **Deploy:** `supabase functions deploy whatsapp-webhook --no-verify-jwt --project-ref sjjesqyqaikivonjuxfs`
5. **Meta app → WhatsApp → Configuration → Webhook:**
   Callback URL `https://sjjesqyqaikivonjuxfs.supabase.co/functions/v1/whatsapp-webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN`,
   then **Verify and save** and subscribe the **messages** field. The WABA must be subscribed to the app (WhatsApp Manager does this automatically for the app that owns the number).
6. **Dry run:** place one test order. On the staff phone, tap Accept. `select * from public.notification_log order by id desc limit 3;`
   shows `received` plus a `dry_run` reply, and the staff app shows the order as Accepted. Cancel the test order in the staff app.
7. **Live replies:** `supabase secrets set WHATSAPP_DRY_RUN=false`.

Pause: in Meta, unsubscribe the `messages` field, or `supabase secrets unset WHATSAPP_APP_SECRET` (every POST is then rejected with 401).
Note: replies are free-form text. They are allowed because staff just messaged the business number, which opens the 24-hour window.
