-- vegpos_v7_hours_cash_loyalty_promos (additive)
-- ---------- 1) settings: hours / notice / contact / loyalty ----------
alter table public.settings
  add column if not exists open_time time not null default '12:00',
  add column if not exists close_time time not null default '21:00',
  add column if not exists min_notice_minutes int not null default 60,
  add column if not exists slot_minutes int not null default 15,
  add column if not exists max_days_ahead int not null default 14,
  add column if not exists open_days int[] not null default '{1,2,3,4,5,6,7}',
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists bulk_note text not null default 'Bulk orders accepted. Contact us for enquiries.',
  add column if not exists loyalty_enabled boolean not null default true,
  add column if not exists loyalty_earn_per_dollar numeric(6,2) not null default 1,
  add column if not exists loyalty_redeem_points int not null default 100,
  add column if not exists loyalty_redeem_value numeric(8,2) not null default 10;
do $$ begin
  alter table public.settings add constraint settings_v7_chk check (
    open_time < close_time and min_notice_minutes between 0 and 1440 and slot_minutes in (5,10,15,20,30,60)
    and max_days_ahead between 1 and 60 and open_days <@ '{1,2,3,4,5,6,7}'::int[]
    and loyalty_earn_per_dollar >= 0 and loyalty_redeem_points > 0 and loyalty_redeem_value >= 0
    and char_length(coalesce(contact_phone,'')) <= 30 and char_length(coalesce(contact_email,'')) <= 120 and char_length(bulk_note) <= 200);
exception when duplicate_object then null; end $$;

-- ---------- 2) promotions ----------
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 200),
  kind text not null check (kind in ('percent','fixed')),
  value numeric(10,2) not null check (value > 0),
  min_order numeric(10,2) not null default 0 check (min_order >= 0),
  active boolean not null default true,
  show_on_menu boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit int check (usage_limit is null or usage_limit > 0),
  used_count int not null default 0,
  archived boolean not null default false,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index if not exists promotions_code_live_uq on public.promotions (code) where not archived;

create table if not exists public.promotion_uses (
  id bigint generated always as identity primary key,
  promo_id uuid not null references public.promotions(id),
  order_id uuid not null references public.orders(id),
  order_no bigint,
  delta int not null check (delta in (-1, 1)),
  note text,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists promotion_uses_order_idx on public.promotion_uses (order_id);
create index if not exists promotion_uses_promo_idx on public.promotion_uses (promo_id);

-- ---------- 3) customers + loyalty ledger ----------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,            -- normalised NZ digits (e.g. 0211234567)
  display_phone text,
  name text,
  points int not null default 0,
  lifetime_points int not null default 0,
  redeemed_points int not null default 0,
  total_spent numeric(12,2) not null default 0,
  paid_orders int not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.loyalty_ledger (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id),
  phone text not null,
  order_id uuid references public.orders(id),
  order_no bigint,
  kind text not null check (kind in ('earn','earn_reversal','earn_adjust','redeem','redeem_reversal','manual')),
  points int not null,
  amount numeric(10,2),
  balance_after int not null,
  note text,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists loyalty_ledger_order_idx on public.loyalty_ledger (order_id);
create index if not exists loyalty_ledger_customer_idx on public.loyalty_ledger (customer_id);

-- ---------- 4) orders: cash / promo / points columns ----------
alter table public.orders
  add column if not exists cash_received numeric(10,2),
  add column if not exists change_given numeric(10,2),
  add column if not exists tip numeric(10,2) not null default 0,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by text,
  add column if not exists promo_id uuid references public.promotions(id),
  add column if not exists promo_code text,
  add column if not exists promo_discount numeric(10,2) not null default 0,
  add column if not exists points_redeemed int not null default 0,
  add column if not exists points_discount numeric(10,2) not null default 0;
create index if not exists orders_promo_idx on public.orders (promo_id);
create index if not exists orders_paid_at_idx on public.orders (paid_at);

-- ---------- 5) protection: RLS, grants, append-only, no deletes, audit ----------
alter table public.promotions enable row level security;
alter table public.promotion_uses enable row level security;
alter table public.customers enable row level security;
alter table public.loyalty_ledger enable row level security;
revoke all on public.promotions, public.promotion_uses, public.customers, public.loyalty_ledger from anon, public;
revoke all on public.promotions, public.promotion_uses, public.customers, public.loyalty_ledger from authenticated;
grant select, insert, update on public.promotions to authenticated;
grant select on public.promotion_uses, public.customers, public.loyalty_ledger to authenticated;
create policy staff_read_promotions on public.promotions for select to authenticated using ((select private.is_staff()));
create policy staff_insert_promotions on public.promotions for insert to authenticated with check ((select private.is_staff()));
create policy staff_update_promotions on public.promotions for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy staff_read_promotion_uses on public.promotion_uses for select to authenticated using ((select private.is_staff()));
create policy staff_read_customers on public.customers for select to authenticated using ((select private.is_staff()));
create policy staff_read_loyalty on public.loyalty_ledger for select to authenticated using ((select private.is_staff()));

create or replace function private.ledger_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'VEGPOS_PROTECTED: % is append-only', tg_table_name using errcode = '42501';
end $$;
create trigger vegpos_append_only before update or delete on public.loyalty_ledger for each row execute function private.ledger_append_only();
create trigger vegpos_no_truncate before truncate on public.loyalty_ledger for each statement execute function private.ledger_append_only();
create trigger vegpos_append_only before update or delete on public.promotion_uses for each row execute function private.ledger_append_only();
create trigger vegpos_no_truncate before truncate on public.promotion_uses for each statement execute function private.ledger_append_only();
create trigger vegpos_block_delete before delete on public.promotions for each row execute function private.block_delete();
create trigger vegpos_block_delete before delete on public.customers for each row execute function private.block_delete();
create trigger vegpos_audit after insert or update or delete on public.promotions for each row execute function private.audit_row();
create trigger vegpos_audit after insert or update or delete on public.customers for each row execute function private.audit_row();
create trigger promotions_set_updated_at before update on public.promotions for each row execute function private.set_updated_at();
create trigger customers_set_updated_at before update on public.customers for each row execute function private.set_updated_at();

create or replace function private.promo_normalise()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.code := upper(btrim(new.code));
  if tg_op = 'UPDATE' and new.used_count is distinct from old.used_count and current_user <> 'postgres' then
    new.used_count := old.used_count;  -- only the system counts uses
  end if;
  return new;
end $$;
create trigger promotions_normalise before insert or update on public.promotions for each row execute function private.promo_normalise();

-- ---------- 6) helpers ----------
create or replace function private.norm_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select case when d is null or length(d) < 6 then null
              when d like '64%' and length(d) >= 9 then '0' || substr(d, 3)
              else d end
  from (select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') as d) x;
$$;

create or replace function private.fmt_hm(t time)
returns text language sql immutable set search_path = '' as $$
  select lower(to_char(('2000-01-01 ' || t::text)::timestamp, 'FMHH12:MI am'));
$$;

-- returns null if the promo can be used on an order of p_amount, else a friendly message
create or replace function private.promo_problem(p public.promotions, p_amount numeric, p_same_order boolean default false)
returns text language sql stable set search_path = '' as $$
  select case
    when p.id is null then 'Sorry, that promo code isn''t recognised'
    when p.archived or not p.active then 'Sorry, that promo code isn''t active right now'
    when p.starts_at is not null and p.starts_at > now() then 'That promo code starts on ' || to_char(p.starts_at at time zone 'Pacific/Auckland', 'FMDy FMDD Mon')
    when p.ends_at is not null and p.ends_at <= now() then 'Sorry, that promo code has expired'
    when not p_same_order and p.usage_limit is not null and p.used_count >= p.usage_limit then 'Sorry, that promo code has been fully used'
    when p_amount < p.min_order then 'Spend at least $' || to_char(p.min_order, 'FM9999990.00') || ' to use this code'
  end;
$$;

create or replace function private.promo_amount(p public.promotions, p_amount numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when p.id is null or p_amount <= 0 then 0
              when p.kind = 'percent' then least(round(p_amount * p.value / 100, 2), p_amount)
              else least(p.value, p_amount) end;
$$;

-- ---------- 7) payment stamp (runs after the lock guard: name sorts later) ----------
create or replace function private.order_paid_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.paid and (tg_op = 'INSERT' or not old.paid) then
    new.paid_at := coalesce(new.paid_at, now());
    new.paid_by := coalesce(new.paid_by, auth.jwt() ->> 'email', new.created_by);
  elsif tg_op = 'UPDATE' and old.paid and not new.paid then
    new.paid_at := null; new.paid_by := null; new.cash_received := null; new.change_given := null; new.tip := 0;
  end if;
  return new;
end $$;
create trigger vegpos_paid_stamp before insert or update on public.orders for each row execute function private.order_paid_stamp();

-- ---------- 8) loyalty + promo usage bookkeeping (append-only ledgers) ----------
create or replace function private.order_ledgers()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  s public.settings; v_phone text; v_cid uuid; v_bal int; v_cur int; v_want int; v_d int; r record; v_n int;
begin
  select * into s from public.settings where id = 1;
  v_phone := private.norm_phone(new.customer_phone);

  -- promo usage
  for r in select u.promo_id, sum(u.delta)::int as n from public.promotion_uses u where u.order_id = new.id group by u.promo_id loop
    if r.n > 0 and (r.promo_id is distinct from new.promo_id or new.status = 'cancelled') then
      insert into public.promotion_uses (promo_id, order_id, order_no, delta, note)
      values (r.promo_id, new.id, new.order_no, -1, case when new.status = 'cancelled' then 'order cancelled' else 'promo removed from order' end);
      update public.promotions set used_count = greatest(used_count - 1, 0) where id = r.promo_id;
    end if;
  end loop;
  if new.promo_id is not null and new.status <> 'cancelled' then
    select coalesce(sum(u.delta), 0)::int into v_n from public.promotion_uses u where u.order_id = new.id and u.promo_id = new.promo_id;
    if v_n <= 0 then
      insert into public.promotion_uses (promo_id, order_id, order_no, delta, note) values (new.promo_id, new.id, new.order_no, 1, 'applied');
      update public.promotions set used_count = used_count + 1 where id = new.promo_id;
    end if;
  end if;

  -- customer record (keyed by normalised phone)
  select l.customer_id into v_cid from public.loyalty_ledger l where l.order_id = new.id order by l.id desc limit 1;
  if v_cid is null and v_phone is not null then
    select c.id into v_cid from public.customers c where c.phone = v_phone;
    if v_cid is null then
      insert into public.customers (phone, display_phone, name, last_order_at)
      values (v_phone, btrim(new.customer_phone), case when new.customer_name ~* '^walk-?in$' then null else nullif(btrim(new.customer_name), '') end, now())
      on conflict (phone) do nothing returning id into v_cid;
      if v_cid is null then select c.id into v_cid from public.customers c where c.phone = v_phone; end if;
    end if;
  end if;
  if v_cid is null then return null; end if;

  -- points redeemed on this order
  select coalesce(-sum(l.points), 0)::int into v_cur from public.loyalty_ledger l where l.order_id = new.id and l.kind in ('redeem', 'redeem_reversal');
  v_want := case when new.status <> 'cancelled' then coalesce(new.points_redeemed, 0) else 0 end;
  v_d := v_want - v_cur;
  if v_d <> 0 then
    update public.customers set points = points - v_d, redeemed_points = redeemed_points + v_d where id = v_cid returning points into v_bal;
    insert into public.loyalty_ledger (customer_id, phone, order_id, order_no, kind, points, amount, balance_after, note)
    values (v_cid, coalesce(v_phone, (select phone from public.customers where id = v_cid)), new.id, new.order_no,
            case when v_d > 0 then 'redeem' else 'redeem_reversal' end, -v_d, new.points_discount, v_bal,
            case when v_d < 0 and new.status = 'cancelled' then 'order cancelled' end);
  end if;

  -- points earned when the order is paid
  select coalesce(sum(l.points), 0)::int into v_cur from public.loyalty_ledger l where l.order_id = new.id and l.kind in ('earn', 'earn_reversal', 'earn_adjust');
  if new.paid and new.status <> 'cancelled' and s.loyalty_enabled then
    if v_cur > 0 and tg_op = 'UPDATE' and new.total = old.total then v_want := v_cur;
    else v_want := floor(new.total * s.loyalty_earn_per_dollar)::int; end if;
  else
    v_want := 0;
  end if;
  v_d := v_want - v_cur;
  if v_d <> 0 then
    update public.customers set points = points + v_d, lifetime_points = lifetime_points + v_d,
      total_spent = total_spent + case when v_cur = 0 then new.total when v_want = 0 then -coalesce(old.total, new.total) else new.total - coalesce(old.total, new.total) end,
      paid_orders = paid_orders + case when v_cur = 0 then 1 when v_want = 0 then -1 else 0 end,
      last_order_at = now()
    where id = v_cid returning points into v_bal;
    insert into public.loyalty_ledger (customer_id, phone, order_id, order_no, kind, points, amount, balance_after, note)
    values (v_cid, (select phone from public.customers where id = v_cid), new.id, new.order_no,
            case when v_cur = 0 then 'earn' when v_want = 0 then 'earn_reversal' else 'earn_adjust' end, v_d, new.total, v_bal,
            case when v_want = 0 and new.status = 'cancelled' then 'order cancelled' when v_want = 0 then 'marked unpaid' end);
  end if;
  return null;
end $$;
revoke all on function private.order_ledgers() from public, anon, authenticated;
create trigger vegpos_ledgers after insert or update on public.orders for each row execute function private.order_ledgers();

-- ---------- 9) staff: recompute promo / points discounts on an order ----------
create or replace function private.apply_order_discounts(p_order_id uuid, p_promo_code text, p_points int, p_manual numeric)
returns public.orders language plpgsql set search_path = '' as $$
declare o public.orders; s public.settings; p public.promotions; v_manual numeric; v_promo numeric := 0; v_pts int; v_ptsd numeric := 0;
        v_left numeric; v_msg text; v_code text; v_have int; v_promo_id uuid; v_pc text;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then raise exception 'This order is cancelled'; end if;
  select * into s from public.settings where id = 1;
  v_manual := least(greatest(coalesce(p_manual, o.discount - o.promo_discount - o.points_discount), 0), o.subtotal);
  v_left := o.subtotal - v_manual;
  -- promo: null = keep current, '' = remove
  v_code := upper(btrim(p_promo_code));
  if v_code is null then
    if o.promo_id is not null then select * into p from public.promotions where id = o.promo_id; v_promo_id := o.promo_id; v_pc := o.promo_code; end if;
  elsif v_code <> '' then
    select * into p from public.promotions where code = v_code and not archived for update;
    v_msg := private.promo_problem(p, v_left, p.id is not distinct from o.promo_id);
    if v_msg is not null then raise exception '%', v_msg; end if;
    v_promo_id := p.id; v_pc := p.code;
  end if;
  if v_promo_id is not null then v_promo := private.promo_amount(p, v_left); end if;
  v_left := v_left - v_promo;
  -- points
  v_pts := greatest(coalesce(p_points, o.points_redeemed), 0);
  if v_pts > 0 then
    if not s.loyalty_enabled then raise exception 'Loyalty points are switched off in Settings'; end if;
    if v_pts % s.loyalty_redeem_points <> 0 then raise exception 'Redeem points in blocks of %', s.loyalty_redeem_points; end if;
    select c.points + o.points_redeemed into v_have from public.customers c where c.phone = private.norm_phone(o.customer_phone);
    if v_have is null then raise exception 'Add the customer''s phone number to use points'; end if;
    if v_have < v_pts then raise exception 'Not enough points (this customer has %)', v_have; end if;
    v_ptsd := (v_pts / s.loyalty_redeem_points) * s.loyalty_redeem_value;
    if v_ptsd > v_left + 0.001 then raise exception 'That is more points than this order needs (max discount %)', '$' || to_char(v_left, 'FM9999990.00'); end if;
  end if;
  update public.orders set promo_id = v_promo_id, promo_code = v_pc, promo_discount = v_promo,
    points_redeemed = v_pts, points_discount = v_ptsd,
    discount = round(v_manual + v_promo + v_ptsd, 2), total = greatest(round(o.subtotal - v_manual - v_promo - v_ptsd, 2), 0)
  where id = p_order_id returning * into o;
  return o;
end $$;
revoke all on function private.apply_order_discounts(uuid, text, int, numeric) from public, anon;
grant execute on function private.apply_order_discounts(uuid, text, int, numeric) to authenticated;

create or replace function public.set_order_discounts(p_order_id uuid, p_promo_code text default null, p_redeem_points int default null, p_manual_discount numeric default null)
returns public.orders language sql set search_path = '' as $$
  select * from private.apply_order_discounts(p_order_id, p_promo_code, p_redeem_points, p_manual_discount);
$$;

-- ---------- 10) staff: one-tap cash payment ----------
create or replace function public.mark_order_paid_cash(p_order_id uuid, p_cash_received numeric default null, p_keep_tip boolean default false)
returns public.orders language plpgsql set search_path = '' as $$
declare o public.orders; v_rec numeric; v_extra numeric;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then raise exception 'This order is cancelled'; end if;
  v_rec := round(coalesce(p_cash_received, o.total), 2);
  if v_rec < o.total then raise exception 'Cash received (%) is less than the total (%)', '$' || to_char(v_rec, 'FM9999990.00'), '$' || to_char(o.total, 'FM9999990.00'); end if;
  if v_rec > o.total + 1000 then raise exception 'Cash received looks too large'; end if;
  v_extra := v_rec - o.total;
  perform set_config('vegpos.audit_note', format('payment: cash, received %s, %s %s', v_rec, case when coalesce(p_keep_tip, false) then 'tip' else 'change' end, v_extra), true);
  update public.orders set paid = true, payment_method = 'cash', cash_received = v_rec,
    change_given = case when coalesce(p_keep_tip, false) then 0 else v_extra end,
    tip = case when coalesce(p_keep_tip, false) then v_extra else 0 end,
    paid_at = coalesce(case when o.paid then o.paid_at end, now()), paid_by = auth.jwt() ->> 'email'
  where id = p_order_id returning * into o;
  return o;
end $$;

-- ---------- 11) staff: save + discounts + (optional) cash payment in one call ----------
create or replace function public.save_order_full(
  p_order_id uuid, p_customer_name text, p_customer_phone text, p_pickup_time timestamptz, p_items jsonb,
  p_notes text default null, p_payment_method text default null, p_paid boolean default false, p_discount numeric default 0,
  p_promo_code text default null, p_redeem_points int default 0, p_paid_cash boolean default false,
  p_cash_received numeric default null, p_keep_tip boolean default false)
returns public.orders language plpgsql set search_path = '' as $$
declare o public.orders; v_new boolean := p_order_id is null; v_name text := coalesce(nullif(btrim(p_customer_name), ''), 'Walk-in');
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  o := public.save_order(p_order_id, v_name, p_customer_phone, p_pickup_time, p_items, p_notes,
         case when p_paid_cash then 'cash' else p_payment_method end,
         case when v_new or p_paid_cash then false else p_paid end, p_discount);
  if coalesce(p_promo_code, '') <> '' or coalesce(p_redeem_points, 0) > 0 or o.promo_id is not null or o.points_redeemed > 0 then
    o := private.apply_order_discounts(o.id, case when p_promo_code is null and v_new then '' else p_promo_code end, coalesce(p_redeem_points, 0), p_discount);
  end if;
  if p_paid_cash then
    o := public.mark_order_paid_cash(o.id, p_cash_received, p_keep_tip);
  elsif v_new and p_paid then
    update public.orders set paid = true where id = o.id returning * into o;
  end if;
  return o;
end $$;

-- ---------- 12) staff: shop settings (hours, contact, loyalty) ----------
create or replace function private.save_shop_settings_sd(p jsonb)
returns public.settings language plpgsql security definer set search_path = '' as $$
declare r public.settings;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  perform set_config('vegpos.audit_note', 'shop settings', true);
  update public.settings set
    open_time = coalesce((p ->> 'open_time')::time, open_time),
    close_time = coalesce((p ->> 'close_time')::time, close_time),
    min_notice_minutes = coalesce((p ->> 'min_notice_minutes')::int, min_notice_minutes),
    max_days_ahead = coalesce((p ->> 'max_days_ahead')::int, max_days_ahead),
    open_days = coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p -> 'open_days') x), open_days),
    contact_phone = case when p ? 'contact_phone' then nullif(btrim(p ->> 'contact_phone'), '') else contact_phone end,
    contact_email = case when p ? 'contact_email' then nullif(lower(btrim(p ->> 'contact_email')), '') else contact_email end,
    bulk_note = coalesce(nullif(btrim(p ->> 'bulk_note'), ''), bulk_note),
    loyalty_enabled = coalesce((p ->> 'loyalty_enabled')::boolean, loyalty_enabled),
    loyalty_earn_per_dollar = coalesce((p ->> 'loyalty_earn_per_dollar')::numeric, loyalty_earn_per_dollar),
    loyalty_redeem_points = coalesce((p ->> 'loyalty_redeem_points')::int, loyalty_redeem_points),
    loyalty_redeem_value = coalesce((p ->> 'loyalty_redeem_value')::numeric, loyalty_redeem_value),
    updated_at = now()
  where id = 1 returning * into r;
  if r.contact_email is not null and r.contact_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Contact email looks invalid'; end if;
  if r.contact_phone is not null and r.contact_phone !~ '^\+?[0-9 ()-]{6,20}$' then raise exception 'Contact phone looks invalid'; end if;
  return r;
end $$;
revoke all on function private.save_shop_settings_sd(jsonb) from public, anon;
grant execute on function private.save_shop_settings_sd(jsonb) to authenticated;
create or replace function public.save_shop_settings(p jsonb)
returns public.settings language sql set search_path = '' as $$ select * from private.save_shop_settings_sd(p); $$;

revoke all on function public.set_order_discounts(uuid, text, int, numeric), public.mark_order_paid_cash(uuid, numeric, boolean),
  public.save_order_full(uuid, text, text, timestamptz, jsonb, text, text, boolean, numeric, text, int, boolean, numeric, boolean),
  public.save_shop_settings(jsonb) from public, anon;
grant execute on function public.set_order_discounts(uuid, text, int, numeric), public.mark_order_paid_cash(uuid, numeric, boolean),
  public.save_order_full(uuid, text, text, timestamptz, jsonb, text, text, boolean, numeric, text, int, boolean, numeric, boolean),
  public.save_shop_settings(jsonb) to authenticated, service_role;

-- ---------- 13) public (anon): shop info + checkout quote ----------
create or replace function public.get_public_info()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'business_name', s.business_name,
    'open_time', to_char(s.open_time, 'HH24:MI'), 'close_time', to_char(s.close_time, 'HH24:MI'),
    'min_notice_minutes', s.min_notice_minutes, 'slot_minutes', s.slot_minutes, 'max_days_ahead', s.max_days_ahead,
    'open_days', to_jsonb(s.open_days), 'contact_phone', s.contact_phone, 'contact_email', s.contact_email, 'bulk_note', s.bulk_note,
    'loyalty', jsonb_build_object('enabled', s.loyalty_enabled, 'earn_per_dollar', s.loyalty_earn_per_dollar,
                                  'redeem_points', s.loyalty_redeem_points, 'redeem_value', s.loyalty_redeem_value),
    'promotions', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'description', p.description,
                      'kind', p.kind, 'value', p.value, 'min_order', p.min_order, 'ends_at', p.ends_at) order by p.created_at desc)
                    from public.promotions p
                    where p.show_on_menu and p.active and not p.archived and (p.starts_at is null or p.starts_at <= now())
                      and (p.ends_at is null or p.ends_at > now()) and (p.usage_limit is null or p.used_count < p.usage_limit)), '[]'::jsonb))
  from public.settings s where s.id = 1;
$$;

create or replace function public.get_checkout_quote(p_items jsonb default null, p_promo_code text default null, p_phone text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.settings; v_sub numeric := 0; v_line jsonb; v_var jsonb; v_prod record; v_q int; p public.promotions; v_msg text;
        v_disc numeric := 0; v_promo jsonb := null; v_pts int := null; v_code text := upper(btrim(coalesce(p_promo_code, ''))); v_phone text;
begin
  select * into s from public.settings where id = 1;
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_line in select e.value from jsonb_array_elements(p_items) e limit 30 loop
      continue when jsonb_typeof(v_line) <> 'object' or coalesce(v_line ->> 'product_id', '') !~* '^[0-9a-f-]{36}$' or coalesce(v_line ->> 'qty', '') !~ '^[0-9]{1,2}$';
      v_q := least((v_line ->> 'qty')::int, 50);
      select pr.variants into v_prod from public.products pr where pr.id = (v_line ->> 'product_id')::uuid and pr.active and not pr.archived;
      continue when not found;
      select e.value into v_var from jsonb_array_elements(v_prod.variants) e where lower(e.value ->> 'label') = lower(coalesce(v_line ->> 'variant', '')) limit 1;
      continue when v_var is null or (v_var ->> 'price') !~ '^[0-9]+(\.[0-9]+)?$';
      v_sub := v_sub + (v_var ->> 'price')::numeric * v_q;
    end loop;
  end if;
  v_sub := round(v_sub, 2);
  if v_code <> '' then
    select * into p from public.promotions where code = v_code and not archived;
    v_msg := private.promo_problem(p, v_sub);
    if v_msg is null then
      v_disc := private.promo_amount(p, v_sub);
      v_promo := jsonb_build_object('ok', true, 'code', p.code, 'name', p.name, 'discount', v_disc);
    else
      v_promo := jsonb_build_object('ok', false, 'message', v_msg);
    end if;
  end if;
  v_phone := private.norm_phone(p_phone);
  if s.loyalty_enabled and v_phone is not null then
    select c.points into v_pts from public.customers c where c.phone = v_phone;
    v_pts := coalesce(v_pts, 0);
  end if;
  return jsonb_build_object('subtotal', v_sub, 'discount', v_disc, 'total', greatest(v_sub - v_disc, 0), 'promo', v_promo,
    'points', v_pts, 'earn', case when s.loyalty_enabled then floor(greatest(v_sub - v_disc, 0) * s.loyalty_earn_per_dollar)::int else 0 end);
end $$;
revoke all on function public.get_public_info(), public.get_checkout_quote(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.get_public_info(), public.get_checkout_quote(jsonb, text, text) to anon, authenticated, service_role;

-- ---------- 14) realtime ----------
alter publication supabase_realtime add table public.customers, public.promotions;

-- ---------- 15) data fixes (logged via audit trigger) ----------
select set_config('vegpos.audit_note', 'v7 data fix: Veg Manchurian 12pcs pieces 8 -> 12', true);
update public.products set variants = jsonb_set(variants, '{1,pieces}', '12'::jsonb)
where id = '81442ca7-4813-40b1-b506-1feabcb64960' and variants -> 1 ->> 'label' = '12pcs' and (variants -> 1 ->> 'pieces') = '8';
select set_config('vegpos.audit_note', 'v7 rebrand: business name rasoi', true);
update public.settings set business_name = 'rasoi', updated_at = now() where id = 1;

-- ---------- 16) customer order: hours / notice / promo (v7) ----------
drop function if exists public.place_customer_order(text, text, timestamptz, jsonb, text);
create or replace function public.place_customer_order(
  p_customer_name text,
  p_customer_phone text default null,
  p_pickup_time timestamptz default null,
  p_items jsonb default null,
  p_notes text default null,
  p_promo_code text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name   text := btrim(coalesce(p_customer_name, ''));
  v_phone  text := nullif(btrim(coalesce(p_customer_phone, '')), '');
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
  v_items  jsonb := '[]'::jsonb;
  v_sub    numeric(10,2) := 0;
  v_line   jsonb;
  v_n      bigint;
  v_key    text;
  v_pid    uuid;
  v_qty    int;
  v_vidx   int;
  v_var    jsonb;
  v_price  numeric;
  v_pieces int;
  v_prod   record;
  v_order  public.orders;
  r        record;
  v_digits text;
  v_dup    public.orders;
  s        public.settings;
  v_local  timestamp;
  v_promo  public.promotions;
  v_pdisc  numeric(10,2) := 0;
  v_msg    text;
  v_code   text := nullif(upper(btrim(coalesce(p_promo_code, ''))), '');
  v_notice text;
begin
  -- serialise customer-app orders (tiny volume) so the guards below are race-free
  perform pg_advisory_xact_lock(hashtext('vegpos_customer_order'));
  -- ---- customer details ----
  if v_name = '' then raise exception 'Please enter your name'; end if;
  if char_length(v_name) > 80 then raise exception 'Name must be 80 characters or fewer'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{6,20}$' then
    raise exception 'Phone number looks invalid (digits, spaces, + ( ) - only, max 20 characters)';
  end if;
  if v_notes is not null and char_length(v_notes) > 300 then raise exception 'Notes must be 300 characters or fewer'; end if;

  -- ---- pickup time ----
  if p_pickup_time is null then raise exception 'Pickup time is required'; end if;
  select * into s from public.settings where id = 1;
  if p_pickup_time < now() - interval '5 minutes' then raise exception 'Pickup time cannot be in the past'; end if;
  v_notice := case when s.min_notice_minutes % 60 = 0 then (s.min_notice_minutes / 60)::text || case when s.min_notice_minutes = 60 then ' hour' else ' hours' end
                   else s.min_notice_minutes::text || ' minutes' end;
  if p_pickup_time < now() + make_interval(mins => s.min_notice_minutes) - interval '3 minutes' then
    raise exception 'Please order at least % ahead. Choose a pickup time from % onwards.', v_notice,
      private.fmt_hm((now() + make_interval(mins => s.min_notice_minutes) at time zone 'Pacific/Auckland')::time);
  end if;
  if p_pickup_time > now() + make_interval(days => s.max_days_ahead) then
    raise exception 'Pickup time must be within the next % days', s.max_days_ahead;
  end if;
  v_local := p_pickup_time at time zone 'Pacific/Auckland';
  if not (extract(isodow from v_local)::int = any (s.open_days)) then
    raise exception 'Sorry, we are closed on %s. Please choose another day.', to_char(v_local, 'FMDay');
  end if;
  if v_local::time < s.open_time or v_local::time > s.close_time then
    raise exception 'Pickup is available from % to % (NZ time). Please choose a time within opening hours.', private.fmt_hm(s.open_time), private.fmt_hm(s.close_time);
  end if;

  -- ---- light abuse guards (v6) ----
  v_digits := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
  if v_digits is not null and (
       select count(*) from public.orders o
       where o.created_by = 'customer-app' and o.created_at > now() - interval '10 minutes'
         and regexp_replace(coalesce(o.customer_phone, ''), '[^0-9]', '', 'g') = v_digits) >= 5 then
    raise exception 'Too many orders from this phone number in the last few minutes. Please wait a little or call us.';
  end if;
  if (select count(*) from public.orders o
      where o.created_by = 'customer-app' and o.created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'We are receiving a lot of orders right now. Please try again in a few minutes or call us.';
  end if;

  -- ---- items ----
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Too many items (maximum 30 lines per order)'; end if;

  for v_line, v_n in select e.value, e.ordinality from jsonb_array_elements(p_items) with ordinality e loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'Item %: invalid item', v_n; end if;

    v_key := coalesce(v_line ->> 'product_id', v_line ->> 'productId');
    if v_key is null or v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Item %: unknown product', v_n;
    end if;
    v_pid := v_key::uuid;

    v_key := v_line ->> 'qty';
    if v_key is null or v_key !~ '^[0-9]{1,3}$' or v_key::int < 1 or v_key::int > 50 then
      raise exception 'Item %: quantity must be a whole number from 1 to 50', v_n;
    end if;
    v_qty := v_key::int;

    select p.id, p.name, p.variants, p.active, p.archived into v_prod
    from public.products p where p.id = v_pid;
    if not found or not v_prod.active or v_prod.archived then
      raise exception 'Item %: this product is not available', v_n;
    end if;

    v_var := null; v_vidx := null;
    if jsonb_typeof(v_line -> 'variant') = 'string' then
      select e.value, (e.ordinality - 1)::int into v_var, v_vidx
      from jsonb_array_elements(v_prod.variants) with ordinality e
      where lower(btrim(e.value ->> 'label')) = lower(btrim(v_line ->> 'variant'))
      order by e.ordinality limit 1;
    else
      v_key := coalesce(v_line ->> 'variant_index', v_line ->> 'variantIndex',
                        case when jsonb_typeof(v_line -> 'variant') = 'number' then v_line ->> 'variant' end);
      if v_key ~ '^[0-9]{1,3}$' and v_key::int < jsonb_array_length(v_prod.variants) then
        v_vidx := v_key::int;
        v_var := v_prod.variants -> v_vidx;
      end if;
    end if;
    if v_var is null or jsonb_typeof(v_var) <> 'object'
       or coalesce(btrim(v_var ->> 'label'), '') = ''
       or (v_var ->> 'price') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Item %: option is not available for %', v_n, v_prod.name;
    end if;

    -- server-side price; anything the client sent is ignored
    v_price  := (v_var ->> 'price')::numeric;
    v_pieces := case when (v_var ->> 'pieces') ~ '^[0-9]{1,6}$' then (v_var ->> 'pieces')::int else 0 end;
    v_sub    := v_sub + v_price * v_qty;

    -- same item shape the staff app writes
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'qty', v_qty, 'name', v_prod.name, 'price', v_price, 'pieces', v_pieces,
      'variant', v_var ->> 'label', 'productId', v_prod.id, 'variantIndex', v_vidx));
  end loop;
  v_sub := round(v_sub, 2);

  -- ---- promo code (server-validated) ----
  if v_code is not null then
    select * into v_promo from public.promotions p where p.code = v_code and not p.archived for update;
    v_msg := private.promo_problem(v_promo, v_sub);
    if v_msg is not null then raise exception '%', v_msg; end if;
    v_pdisc := private.promo_amount(v_promo, v_sub);
  end if;

  -- exact same order re-sent within 60s (double tap / retry): return the existing order instead of a duplicate
  select * into v_dup from public.orders o
  where o.created_by = 'customer-app' and o.created_at > now() - interval '60 seconds'
    and o.status <> 'cancelled'
    and lower(o.customer_name) = lower(v_name)
    and coalesce(o.customer_phone, '') = coalesce(v_phone, '')
    and o.pickup_time = p_pickup_time
    and coalesce(o.notes, '') = coalesce(v_notes, '')
    and o.items = v_items
    and coalesce(o.promo_code, '') = coalesce(v_promo.code, '')
  order by o.created_at desc limit 1;
  if found then
    return jsonb_build_object('order_no', v_dup.order_no, 'total', v_dup.total, 'subtotal', v_dup.subtotal, 'discount', v_dup.discount,
                              'promo_code', v_dup.promo_code, 'pickup_time', v_dup.pickup_time, 'status', v_dup.status, 'duplicate', true);
  end if;

  -- ---- lock stock sources (deterministic order), then check ----
  perform 1 from public.stock_items si
  where si.id in (select p.stock_item_id from private.piece_map(v_items) m
                  join public.products p on p.id = m.product_id where p.stock_item_id is not null)
  order by si.id for update;
  perform 1 from public.products p
  where p.id in (select m.product_id from private.piece_map(v_items) m) and p.stock_item_id is null
  order by p.id for update;

  for r in
    select coalesce(p.stock_item_id, p.id) as src,
           min(coalesce(si.name, p.name)) as label,
           sum(m.pieces * case when p.stock_item_id is null then 1 else p.stock_factor end)::int as need,
           min(case when p.stock_item_id is null then p.stock else si.stock end) as have
    from private.piece_map(v_items) m
    join public.products p on p.id = m.product_id
    left join public.stock_items si on si.id = p.stock_item_id
    group by 1
  loop
    if r.need > 0 and coalesce(r.have, 0) < r.need then
      raise exception 'Sorry, there is not enough % left for this order. Please reduce the quantity or choose something else.', r.label;
    end if;
  end loop;

  -- ---- create order + deduct exactly like public.save_order ----
  perform set_config('vegpos.audit_note', 'customer-app', true);
  insert into public.orders (customer_name, customer_phone, pickup_time, items, notes, payment_method,
                             paid, discount, subtotal, total, status, created_by, promo_id, promo_code, promo_discount)
  values (v_name, v_phone, p_pickup_time, v_items, v_notes, 'cash',
          false, v_pdisc, v_sub, greatest(v_sub - v_pdisc, 0), 'pending', 'customer-app', v_promo.id, v_promo.code, v_pdisc)
  returning * into v_order;

  for r in select * from private.piece_map(v_items) loop
    perform private.apply_stock(r.product_id, -r.pieces, 'order', 'customer-app', v_order.id, v_order.order_no);
  end loop;

  return jsonb_build_object('order_no', v_order.order_no, 'total', v_order.total, 'subtotal', v_order.subtotal, 'discount', v_order.discount,
                            'promo_code', v_order.promo_code, 'pickup_time', v_order.pickup_time, 'status', v_order.status);
end
$$;


comment on function public.place_customer_order(text, text, timestamptz, jsonb, text, text) is
  'VegPOS v7: public (anon) customer order. Server prices; stock checked + deducted atomically; opening hours, min notice and open days from settings; optional server-validated promo code; v6 rate limits + duplicate collapse.';
revoke all on function public.place_customer_order(text, text, timestamptz, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.place_customer_order(text, text, timestamptz, jsonb, text, text) to anon, authenticated, service_role;
