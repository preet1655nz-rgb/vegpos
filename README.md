# VegPOS

Order, kitchen and inventory app for VegPOS. It is a single `index.html` file with no build step, deployed on Vercel.

## Live sync
All data (menu, prices, stock, orders) is stored in Supabase, so every phone or browser that opens the link sees the same data and updates instantly. The badge at the top shows **Live**, **Connecting…** or **Offline**. When offline, the app shows the last data this device saw, but changes can't be saved until it reconnects.

## Security note
There is no login yet: anyone who has the link can view and change orders, stock and the menu. Adding a staff login (Supabase Auth) is the recommended next step.
