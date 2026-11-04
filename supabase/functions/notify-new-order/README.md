# notify-new-order (prepared, NOT deployed, NOT enabled)

Automatic WhatsApp Cloud API alert to the **staff/owner** WhatsApp number (Settings → Alerts & WhatsApp,
`public.settings.staff_whatsapp`) whenever a row is inserted into `public.orders`. It never messages customers.

Flow: `orders` INSERT → trigger `vegpos_notify_new_order` → `pg_net` POST `{order_id}` with header `x-notify-secret`
→ Edge Function `notify-new-order` → reads order + `staff_whatsapp` with the service role → POST
`https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages` (template `new_order`, lang `en`, body params {{1}}..{{6}})
→ writes a row to `public.notification_log` (sent / error / skipped / dry_run). One successful send per order.

Files
- `supabase/functions/notify-new-order/index.ts` – the function
- `supabase/functions/notify-new-order/template_new_order.txt` – template text to submit in WhatsApp Manager
- `supabase/migrations/20261104070000_v9_whatsapp_cloud_notify_PREPARED.sql` – pg_net, log table, trigger (additive)
- `supabase/config.notify-new-order.toml` – `verify_jwt = false` (the function checks `x-notify-secret` itself)

## Switch-on checklist
1. **Meta (Preet):** WhatsApp Business Account in Meta Business Manager with a sending phone number registered on the
   Cloud API (it cannot be a number currently used in the WhatsApp Business *app* unless migrated/coexistence),
   a payment method on the WABA, a **System User permanent token** with `whatsapp_business_messaging`
   (+ `whatsapp_business_management`), and the **Phone Number ID**.
2. **Template:** create `new_order` (Utility, English `en`) using `template_new_order.txt`; wait for *Approved*.
3. **Staff number:** set Settings → Alerts & WhatsApp → Staff WhatsApp in the staff app (must be a WhatsApp number;
   it must differ from the sending number).
4. **Secrets** (pick a long random `NOTIFY_WEBHOOK_SECRET`):
   `supabase secrets set WHATSAPP_TOKEN=… WHATSAPP_PHONE_NUMBER_ID=… WHATSAPP_TEMPLATE_NAME=new_order WHATSAPP_TEMPLATE_LANG=en NOTIFY_WEBHOOK_SECRET=… WHATSAPP_DRY_RUN=true --project-ref sjjesqyqaikivonjuxfs`
5. **Deploy:** `supabase functions deploy notify-new-order --no-verify-jwt --project-ref sjjesqyqaikivonjuxfs`
6. **Apply the migration** (pg_net + log table + trigger). Still inert until step 7.
7. **Arm it:** `select vault.create_secret('<same NOTIFY_WEBHOOK_SECRET>', 'notify_new_order_secret');`
8. **Dry run:** place one test order → check `select * from public.notification_log order by id desc limit 1;`
   shows `dry_run` with the right params; cancel the test order with the staff app.
9. **Go live:** `supabase secrets set WHATSAPP_DRY_RUN=false`, place one more test order, confirm it arrives on WhatsApp,
   cancel it.

Pause: `alter table public.orders disable trigger vegpos_notify_new_order;` (or delete the Vault secret value).
Business-initiated messages need an approved template; Meta charges per utility message per its current pricing.

## Two-way: accept from WhatsApp
The template now carries a quick-reply **Accept** button (payload `ACCEPT:<order id>`) and the line
'Tap Accept below, or reply "Accepted"'. Replies are handled by `supabase/functions/whatsapp-webhook` — see its README.
If the template is approved without the button, set `WHATSAPP_TEMPLATE_ACCEPT_BUTTON=false`.
