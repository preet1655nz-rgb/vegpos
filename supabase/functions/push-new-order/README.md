# push-new-order (deployed, verify_jwt = false)

Sends a Web Push "New order #N — name · pickup time · total" to every active row in `push_subscriptions`.
Tapping it opens the staff app on that order (`https://vegpos.vercel.app/?order=<id>`).

* Trigger: `vegpos_push_new_order` AFTER INSERT on `public.orders` (customer-app orders, status `pending`) → `pg_net` POST
  with header `x-push-secret` (Vault secret `push_new_order_secret`; URL in Vault `push_new_order_url`).
* VAPID keys: env `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `PUSH_WEBHOOK_SECRET` if set as function secrets, otherwise
  Vault (`vapid_public_key`, `vapid_private_key`, `push_new_order_secret`) via `public.push_config()` (service_role only).
  To move them into function secrets:  `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... PUSH_WEBHOOK_SECRET=... --project-ref sjjesqyqaikivonjuxfs`
* 404/410 from the push service → `revoked_at` set (soft delete, matches the no-hard-delete rule).
* Test: POST `{ "test": true, "endpoint": "<subscription endpoint>" }` with the same secret header.
