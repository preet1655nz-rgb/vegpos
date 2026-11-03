# VegPOS

Order-taking, sales and inventory app for VegPOS, styled like an iPhone app. It's a static site (`index.html`, `styles.css`, `app.js`) with no build step, deployed on Vercel and backed by Supabase.

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
