-- VegPOS v2: staff login (allowlist), richer orders, inventory movements, settings.
-- Safe to re-read; applied once via Supabase migrations.

create schema if not exists private;
grant usage on schema private to authenticated, supabase_auth_admin;

-- ---------- Staff allowlist ----------
create table if not exists public.staff (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  role text not null default 'staff' check (role in ('owner','staff')),
  name text,
  added_by text,
  created_at timestamptz not null default now()
);
insert into public.staff (email, role, name) values ('preet1655.ps@gmail.com', 'owner', 'Preet')
on conflict (email) do update set role = 'owner';

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.email = lower(coalesce(auth.jwt() ->> 'email', '')) and s.role = 'owner');
$$;
revoke all on function private.is_staff() from public, anon;
revoke all on function private.is_owner() from public, anon;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.is_owner() to authenticated;

-- Only allowlisted emails may create an account.
create or replace function private.enforce_staff_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or not exists (select 1 from public.staff s where s.email = lower(new.email)) then
    raise exception 'VEGPOS_NOT_STAFF: % is not on the VegPOS staff list', coalesce(new.email, '(no email)');
  end if;
  return new;
end $$;
revoke all on function private.enforce_staff_signup() from public, anon, authenticated;
grant execute on function private.enforce_staff_signup() to supabase_auth_admin;
drop trigger if exists vegpos_enforce_staff_signup on auth.users;
create trigger vegpos_enforce_staff_signup before insert on auth.users
  for each row execute function private.enforce_staff_signup();

-- ---------- Settings (single row) ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'VegPOS',
  low_stock_default int not null default 10 check (low_stock_default >= 0),
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------- Products ----------
alter table public.products
  add column if not exists category text not null default 'Menu',
  add column if not exists low_stock_threshold int check (low_stock_threshold is null or low_stock_threshold >= 0),
  add column if not exists active boolean not null default true,
  add column if not exists archived boolean not null default false;
update public.products set category = case when name ilike '%momo%' then 'Momos' else 'Snacks' end where category = 'Menu';

-- ---------- Orders ----------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','preparing','ready','completed','cancelled'));
alter table public.orders
  add column if not exists customer_phone text,
  add column if not exists notes text,
  add column if not exists payment_method text check (payment_method is null or payment_method in ('cash','card','online')),
  add column if not exists paid boolean not null default false,
  add column if not exists discount numeric(10,2) not null default 0 check (discount >= 0),
  add column if not exists subtotal numeric(10,2) not null default 0 check (subtotal >= 0),
  add column if not exists created_by text default (auth.jwt() ->> 'email'),
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz;
update public.orders set subtotal = total where subtotal = 0 and total > 0;
create index if not exists orders_pickup_time_idx on public.orders (pickup_time);
create index if not exists orders_created_at_idx on public.orders (created_at);

-- ---------- Stock movements ----------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  delta int not null,
  stock_after int,
  reason text not null check (reason in ('order','order_edit','order_cancel','order_restore','restock','waste','correction','set','initial')),
  note text,
  order_id uuid references public.orders(id) on delete set null,
  order_no bigint,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_created_at_idx on public.stock_movements (created_at desc);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id);
create index if not exists stock_movements_order_idx on public.stock_movements (order_id);

-- ---------- RLS: only signed-in staff; anon gets nothing ----------
drop policy if exists products_select_public on public.products;
drop policy if exists products_insert_public on public.products;
drop policy if exists products_update_public on public.products;
drop policy if exists products_delete_public on public.products;
drop policy if exists orders_select_public on public.orders;
drop policy if exists orders_insert_public on public.orders;
drop policy if exists orders_update_public on public.orders;
drop policy if exists orders_delete_public on public.orders;

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.stock_movements enable row level security;
alter table public.settings enable row level security;
alter table public.staff enable row level security;

create policy staff_all_products on public.products for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy staff_all_orders on public.orders for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy staff_read_movements on public.stock_movements for select to authenticated using ((select private.is_staff()));
create policy staff_insert_movements on public.stock_movements for insert to authenticated with check ((select private.is_staff()));
create policy staff_read_settings on public.settings for select to authenticated using ((select private.is_staff()));
create policy owner_update_settings on public.settings for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy staff_read_staff on public.staff for select to authenticated using ((select private.is_staff()));
create policy owner_insert_staff on public.staff for insert to authenticated with check ((select private.is_owner()));
create policy owner_update_staff on public.staff for update to authenticated
  using ((select private.is_owner()) and role <> 'owner') with check ((select private.is_owner()) and role <> 'owner');
create policy owner_delete_staff on public.staff for delete to authenticated using ((select private.is_owner()) and role <> 'owner');

revoke all on public.products, public.orders, public.stock_movements, public.settings, public.staff from anon;

-- ---------- Stock + order functions (run as the caller, so RLS applies) ----------
drop function if exists public.adjust_product_stock(uuid, int);

create or replace function private.piece_map(p_items jsonb)
returns table (product_id uuid, pieces int)
language sql immutable set search_path = '' as $$
  select (i ->> 'productId')::uuid, sum(coalesce((i ->> 'pieces')::int, 0) * coalesce((i ->> 'qty')::int, 0))::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  where (i ->> 'productId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  group by 1;
$$;

create or replace function private.apply_stock(p_product uuid, p_delta int, p_reason text, p_note text, p_order uuid, p_order_no bigint)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_stock int; v_name text;
begin
  if p_delta = 0 then return null; end if;
  update public.products set stock = stock + p_delta where id = p_product returning stock, name into v_stock, v_name;
  if not found then return null; end if;
  insert into public.stock_movements (product_id, product_name, delta, stock_after, reason, note, order_id, order_no)
  values (p_product, v_name, p_delta, v_stock, p_reason, p_note, p_order, p_order_no);
  return v_stock;
end $$;
revoke all on function private.piece_map(jsonb) from public, anon;
revoke all on function private.apply_stock(uuid, int, text, text, uuid, bigint) from public, anon;
grant execute on function private.piece_map(jsonb) to authenticated;
grant execute on function private.apply_stock(uuid, int, text, text, uuid, bigint) to authenticated;

create or replace function public.adjust_stock(p_product_id uuid, p_delta int, p_reason text default 'correction', p_note text default null)
returns int language plpgsql security invoker set search_path = '' as $$
declare v int;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  if p_reason not in ('restock','waste','correction','initial') then raise exception 'Invalid reason %', p_reason; end if;
  v := private.apply_stock(p_product_id, p_delta, p_reason, nullif(btrim(p_note), ''), null, null);
  if v is null then select stock into v from public.products where id = p_product_id; end if;
  return v;
end $$;

create or replace function public.set_stock(p_product_id uuid, p_value int, p_reason text default 'correction', p_note text default null)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_cur int; v int;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  if p_reason not in ('restock','waste','correction','initial') then raise exception 'Invalid reason %', p_reason; end if;
  select stock into v_cur from public.products where id = p_product_id for update;
  if not found then raise exception 'Item not found'; end if;
  v := private.apply_stock(p_product_id, p_value - v_cur, p_reason, coalesce(nullif(btrim(p_note), ''), 'Set to ' || p_value), null, null);
  return coalesce(v, v_cur);
end $$;

create or replace function public.save_order(
  p_order_id uuid, p_customer_name text, p_customer_phone text, p_pickup_time timestamptz, p_items jsonb,
  p_notes text default null, p_payment_method text default null, p_paid boolean default false, p_discount numeric default 0)
returns public.orders language plpgsql security invoker set search_path = '' as $$
declare
  v_old public.orders; v_new public.orders; v_sub numeric(10,2); v_total numeric(10,2); r record;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  if coalesce(btrim(p_customer_name), '') = '' then raise exception 'Customer name is required'; end if;
  if p_pickup_time is null then raise exception 'Pickup time is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item'; end if;
  select coalesce(round(sum((i ->> 'price')::numeric * (i ->> 'qty')::int), 2), 0) into v_sub from jsonb_array_elements(p_items) i;
  v_total := greatest(v_sub - coalesce(p_discount, 0), 0);

  if p_order_id is null then
    insert into public.orders (customer_name, customer_phone, pickup_time, items, notes, payment_method, paid, discount, subtotal, total, status)
    values (btrim(p_customer_name), nullif(btrim(p_customer_phone), ''), p_pickup_time, p_items, nullif(btrim(p_notes), ''),
            p_payment_method, coalesce(p_paid, false), least(coalesce(p_discount, 0), v_sub), v_sub, v_total, 'pending')
    returning * into v_new;
    for r in select * from private.piece_map(p_items) loop
      perform private.apply_stock(r.product_id, -r.pieces, 'order', null, v_new.id, v_new.order_no);
    end loop;
    return v_new;
  end if;

  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  update public.orders set customer_name = btrim(p_customer_name), customer_phone = nullif(btrim(p_customer_phone), ''),
    pickup_time = p_pickup_time, items = p_items, notes = nullif(btrim(p_notes), ''), payment_method = p_payment_method,
    paid = coalesce(p_paid, false), discount = least(coalesce(p_discount, 0), v_sub), subtotal = v_sub, total = v_total
  where id = p_order_id returning * into v_new;
  if v_old.status <> 'cancelled' then
    for r in
      select coalesce(o.product_id, n.product_id) as product_id, coalesce(o.pieces, 0) - coalesce(n.pieces, 0) as delta
      from private.piece_map(v_old.items) o full join private.piece_map(p_items) n on n.product_id = o.product_id
    loop
      if r.delta <> 0 then perform private.apply_stock(r.product_id, r.delta, 'order_edit', null, v_new.id, v_new.order_no); end if;
    end loop;
  end if;
  return v_new;
end $$;

create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns public.orders language plpgsql security invoker set search_path = '' as $$
declare v_old public.orders; v_new public.orders; r record;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  if p_status not in ('pending','preparing','ready','completed','cancelled') then raise exception 'Invalid status %', p_status; end if;
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_old.status = p_status then return v_old; end if;
  update public.orders set status = p_status,
    completed_at = case when p_status = 'completed' then now() else null end,
    cancelled_at = case when p_status = 'cancelled' then now() else null end
  where id = p_order_id returning * into v_new;
  if p_status = 'cancelled' then
    for r in select * from private.piece_map(v_old.items) loop
      perform private.apply_stock(r.product_id, r.pieces, 'order_cancel', null, v_new.id, v_new.order_no);
    end loop;
  elsif v_old.status = 'cancelled' then
    for r in select * from private.piece_map(v_old.items) loop
      perform private.apply_stock(r.product_id, -r.pieces, 'order_restore', null, v_new.id, v_new.order_no);
    end loop;
  end if;
  return v_new;
end $$;

revoke all on function public.adjust_stock(uuid, int, text, text) from public, anon;
revoke all on function public.set_stock(uuid, int, text, text) from public, anon;
revoke all on function public.save_order(uuid, text, text, timestamptz, jsonb, text, text, boolean, numeric) from public, anon;
revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.adjust_stock(uuid, int, text, text) to authenticated;
grant execute on function public.set_stock(uuid, int, text, text) to authenticated;
grant execute on function public.save_order(uuid, text, text, timestamptz, jsonb, text, text, boolean, numeric) to authenticated;
grant execute on function public.set_order_status(uuid, text) to authenticated;

-- ---------- Realtime ----------
alter table public.stock_movements replica identity full;
alter table public.settings replica identity full;
alter table public.staff replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.stock_movements; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.settings; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.staff; exception when duplicate_object then null; end;
end $$;
