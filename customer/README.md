# rasoi · DELI + KITCHEN — customer pickup ordering app

Static site (no build). Live: https://chopsticks-chaat.vercel.app (Vercel project `chopsticks-chaat`).

- `index.html`, `styles.css`, `app.js`, `brand/rasoi/` (Preet's logo, unmodified, plus crops/resizes — see `brand/rasoi/README.md`)
- Talks to Supabase only via the public RPCs `get_public_menu()`, `get_public_info()`, `get_checkout_quote(...)`,
  `get_points_balance(phone)` and `place_customer_order(...)` with the anon key. Prices, stock, opening hours, notice,
  days ahead and promo codes are enforced server-side from `settings` / `promotions`.
- Pickup only, cash only (pay at pickup). Hours / notice / contact / loyalty rules are edited by staff in the staff app Settings.
