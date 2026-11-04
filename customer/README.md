# rasoi · DELI + KITCHEN — customer pickup ordering app

Static site (no build). Live: https://chopsticks-chaat.vercel.app (Vercel project `chopsticks-chaat`).

- `index.html`, `styles.css`, `app.js`, `brand/rasoi/` (Preet's logo, unmodified, plus crops/resizes — see `brand/rasoi/README.md`)
- Talks to Supabase only via the public RPCs `get_public_menu()`, `get_public_info()`, `get_checkout_quote(...)`,
  `get_points_balance(phone)` and `place_customer_order(...)` with the anon key. Prices, stock, opening hours, notice,
  days ahead and promo codes are enforced server-side from `settings` / `promotions`.
- Pickup only, cash only (pay at pickup). Hours / notice / contact / loyalty rules are edited by staff in the staff app Settings.

## Deploying
Deploy **only this `customer/` folder** to the `chopsticks-chaat` project (production). Check after every deploy that
`https://chopsticks-chaat.vercel.app/` serves `<meta name="build" ...>` from this folder. On 3–4 Nov 2026 a JS-less
mock-up ("Rasoi — Order Online", deployment dpl_ErREcws8NBaNaGqndcR81rHDpBFL) was deployed to production and nobody could order.
Do not promote or roll back to that deployment.
supabase-js is self-hosted and pinned in `vendor/` (no unpinned CDN `@2` tag).
