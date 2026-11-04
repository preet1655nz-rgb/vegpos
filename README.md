# rasoi · DELI + KITCHEN — staff app (VegPOS)

Order-taking, sales and inventory app for rasoi (internal name VegPOS), styled like an iPhone app. It's a static site (`index.html`, `styles.css`, `app.js`) with no build step, deployed on Vercel and backed by Supabase.

## Features
- **Orders**: take orders from a tap-to-add menu with size options. Each order has a customer name and phone, pickup date and time, notes, payment method, paid status and discount. You can also edit, search and filter orders (Active, Completed, Cancelled, by day). Orders show "due soon" and "overdue" badges and a status flow (Pending → Preparing → Ready → Completed). Cancelling an order puts its stock back. You can print a receipt for any order.
- **Inventory**: stock levels with low-stock alerts (a threshold per item or a default). Adjust stock with a reason (restock, waste, correction, other) and see every stock movement in the history. You can add, edit, hide, archive and delete items, with categories, sizes or variants, prices, and optional cost.
- **Insights**: Today, 7 days, 30 days or a custom range. Shows revenue, number of orders, average order and change vs the previous period. Includes charts of revenue over time, peak hours, top items and payment mix, plus CSV export of orders and line items.
- **Settings**: business name, default low-stock level, staff management (owner only), sign out.
- **Live sync**: every change appears on all signed-in devices within about a second (Supabase Realtime).

## Staff login
- **Sign-in**: only emails on the staff list can create an account or sign in (Supabase Auth plus row-level security). Visitors who aren't signed in can't read or change anything.
- **First sign-in**: on the sign-in screen, tap **First time here? Create your password**. Enter your staff email and choose a password, then confirm via the email Supabase sends.
- **Adding staff**: the owner adds staff in **Settings → Staff**.

## Database
The schema changes are in `supabase/migrations/`. Stock updates and order totals run in database functions (`save_order`, `set_order_status`, `adjust_stock`, `set_stock`) so they stay consistent across devices.

## Data protection
- **Nothing is deleted:** orders, items and stock history can't be deleted from the app or by any signed-in user. Cancel an order or archive an item instead. Database triggers also block DELETE and TRUNCATE for everyone except database admins running migrations.
- **Audit log:** every insert, update and delete on orders, items, stock history, staff and settings is recorded in `audit_log`, with the old row, the new row, who made the change and when. The log is append-only: nobody, not even the API service role, can edit or erase it.
- **Locked orders:** a locked order (🔒) can still move through its status and have its payment marked, but its items, totals, customer, times and number can't change, and it can't be cancelled. Only the owner can unlock it, from the order detail screen. The 7 orders imported from the old app are locked.

## v4 — shared stock, item editing, spacious UI

**Shared stock pools.** `stock_items` holds a pooled stock level (e.g. *Frozen Momos*, in pieces). A product links to a pool with
`products.stock_item_id` (+ `stock_factor`, pool pieces per product piece, default 1). Veg Momos Steamed and Veg Momos Fried both
draw from Frozen Momos: a 12pcs ×2 order deducts 24 from the pool. Deduction on order create/edit and restore on cancel happen
inside the existing atomic DB functions (`save_order`, `set_order_status` → `private.apply_stock`), so it is one transaction with a
row-locked update. Every change is a `stock_movements` row carrying `stock_item_id` / `stock_item_name`.
Pool corrections go through `adjust_stock_item` / `set_stock_item` (restock / waste / correction + note). Pools follow the same
rules as everything else: staff-only RLS, no DELETE/TRUNCATE (blocked by trigger), audited, realtime.
Any future item can share stock: Inventory → item → **Edit** → *Stock source*.

**Editing.** Every Inventory row has an **Edit** button (name, category, sizes, prices, pieces, cost, stock source, show on menu,
archive). Stock corrections are never typed into the editor: they go through Add / Remove / Set with a reason, so they are logged.
Items and pools are archived, never deleted.

Migration: `supabase/migrations/20261103203000_vegpos_v4_shared_stock_items.sql` (applied as `vegpos_v4_shared_stock_items`, additive only).

### v4.1 — inventory totals fix
Inventory aggregates now use one entry per real stock source: each shared `stock_items` row is counted exactly once,
and products linked to it never contribute their legacy `products.stock`. This covers Stock on hand (pieces + value when
cost prices exist), Low / Out of stock counts, the header, the Low-stock filter and tab badge, and Restocked/Waste · 7d
(which skip own-stock movements of now-linked products). Linked rows show "Uses <stock>: N pcs" and a "Shared" pill.
No SQL change was needed: there are no views, and the stock functions route linked products to the shared row only.

### v5 — interim rebrand + Remember me
- (The v5 placeholder brand and its SVG assets were replaced by the rasoi brand in v7.)
  Name/tagline are in the `BRAND` constant at the top of `app.js`. Internal names (repo, URL, realtime channel) stay "vegpos".
  The shown business name is Settings → Business name, unless it is still the old default "VegPOS", which shows as the brand.
- **Remember me** (ticked by default): session kept in localStorage with token auto-refresh, last email prefilled.
  Unticked: session in sessionStorage (this tab only), email not saved. The password is never stored by the app —
  `autocomplete="username"` / `"current-password"` lets iCloud Keychain / browser password managers save and autofill it.
  Sign out clears the session from both storages (scope: this device).

## v7 — rasoi rebrand, pickup hours, quick cash, loyalty, promotions

**Brand.** rasoi · DELI + KITCHEN. Teal #0A5C56 (deep #064E3B) on light mint/cream, Inter body text, Caveat script headings.
Logo: `brand/rasoi/rasoi-logo.jpg` is Preet's final file, byte-identical (sha1 `52af1889ebd4a05680e448a6c99e6b2fb5b084f1`);
every other file in `brand/rasoi/` is a straight conversion/crop/resize of it (see `brand/rasoi/README.md`). No filters are applied in CSS.
The customer project serves its own copies from `customer/brand/rasoi/`.

**Customer app (`customer/`).** Pickup only, cash only (paid at pickup). Pickup slots 12:00 pm – 9:00 pm NZ time, at least
60 minutes' notice ("Please order 1–2 hours ahead"), up to 14 days ahead. `place_customer_order` enforces the same rules from
`settings` (open_time, close_time, min_notice_minutes, max_days_ahead, open_days). Optional promo code (validated and counted on
the server), number-only points lookup (`get_points_balance`), menu banner for promotions with `show_on_menu`, and a
"Bulk orders" card whose contact line shows `settings.contact_phone` / `contact_email` only once they are set
(Settings → Customer ordering → Bulk orders contact).

**Quick cash (staff).** One tap **Accept** (row, order sheet, and new-order banner) and one tap **Paid cash**
(`mark_order_paid_cash`). **Cash received…** offers $20 / $50 / $100 / Exact or any amount, shows change due, and
**Keep as tip** records the extra as a tip. Orders store `cash_received`, `change_given`, `tip`, `paid_at`, `paid_by`.
A new order can be saved as paid cash in one tap (`save_order_full`). Insights → Cash shows cash collected, tips and change
for the selected range, with a Payments CSV.

**Loyalty.** Customers are keyed by phone (`customers`) with an append-only `loyalty_ledger`. Points are earned when an order is
marked paid (default 1 point per $1) and reversed if it is cancelled or marked unpaid; 100 points = $10 off (defaults, editable
in Settings → Loyalty rules). Staff see a customer's points on the order and redeem them in blocks (`set_order_discounts`).

**Promotions.** Settings → Promotions: code, name, percent/fixed, value, minimum order, active, start/end, usage limit,
show-on-menu. Archived, never deleted. Every use and reversal is logged in `promotion_uses`.

Migrations: `vegpos_v7_hours_cash_loyalty_promos`, `vegpos_v7b_fix_notice_message`, `vegpos_v7c_points_lookup_rpc_hardening`
(public anon RPCs are now thin SECURITY INVOKER wrappers over SECURITY DEFINER functions in the unexposed `customer_api` schema).
