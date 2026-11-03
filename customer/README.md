# Chopsticks & Chaat — customer ordering app

Static site (no build). Live: https://chopsticks-chaat.vercel.app (Vercel project `chopsticks-chaat`).

- `index.html`, `styles.css`, `app.js`, `brand/` (logo.svg, apple-touch-icon.png, og.jpg)
- Talks to Supabase only via the public RPCs `get_public_menu()` and `place_customer_order(...)` with the anon key
  (prices, stock and limits are enforced server-side; see `supabase/` migrations v5/v6).
- The production deploy inlines `styles.css` into `index.html` (deploy tooling limit); keep both in sync.
- Opening hours / lead time / slot step live in `CFG` at the top of `app.js`.
