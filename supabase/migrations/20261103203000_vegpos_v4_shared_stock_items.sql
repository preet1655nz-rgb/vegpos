-- VegPOS v4: shared stock pools (e.g. one "Frozen Momos" stock used by Steamed + Fried).
-- Additive only: new table + new nullable columns + replaced function bodies. Nothing dropped, nothing deleted.

-- ---------- stock_items ----------
create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  unit text not null default 'pcs',
  stock int not null default 0,
  low_stock_threshold int check (low_stock_threshold is null or low_stock_threshold >= 0),
  archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger stock_items_set_updated_at before update on public.stock_items for each row execute function private.set_updated_at();

-- products link to a shared pool; stock_factor = pool pieces used per product piece (default 1)
alter table public.products add column if not exists stock_item_id uuid references public.stock_items(id) on delete restrict;
alter table public.products add column if not exists stock_factor int not null default 1;
do $$ begin
  alter table public.products add constraint products_stock_factor_check check (stock_factor >= 1);
exception when duplicate_object then null; end $$;
create index if not exists products_stock_item_idx on public.products (stock_item_id);

alter table public.stock_movements add column if not exists stock_item_id uuid references public.stock_items(id) on delete restrict;
alter table public.stock_movements add column if not exists stock_item_name text;
create index if not exists stock_movements_stock_item_idx on public.stock_movements (stock_item_id);

-- ---------- security: staff read/insert/update, no deletes ----------
alter table public.stock_items enable row level security;
revoke all on public.stock_items from anon;
revoke delete, truncate on public.stock_items from authenticated;
grant select, insert, update on public.stock_items to authenticated;
create policy staff_read_stock_items on public.stock_items for select to authenticated using ((select private.is_staff()));
create policy staff_insert_stock_items on public.stock_items for insert to authenticated with check ((select private.is_staff()));
create policy staff_update_stock_items on public.stock_items for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

create trigger vegpos_block_delete before delete on public.stock_items for each row execute function private.block_delete();
create trigger vegpos_block_truncate before truncate on public.stock_items for each statement execute function private.block_delete();
create trigger vegpos_audit after insert or update or delete on public.stock_items for each row execute function private.audit_row();

-- ---------- stock engine: route linked products to their pool (atomic, row-locked UPDATE) ----------
create or replace function private.apply_stock(p_product uuid, p_delta int, p_reason text, p_note text, p_order uuid, p_order_no bigint)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_stock int; v_name text; v_si uuid; v_factor int; v_si_name text; v_d int;
begin
  if p_delta = 0 then return null; end if;
  select name, stock_item_id, stock_factor into v_name, v_si, v_factor from public.products where id = p_product;
  if not found then return null; end if;
  if v_si is null then
    update public.products set stock = stock + p_delta where id = p_product returning stock into v_stock;
    insert into public.stock_movements (product_id, product_name, delta, stock_after, reason, note, order_id, order_no)
    values (p_product, v_name, p_delta, v_stock, p_reason, p_note, p_order, p_order_no);
  else
    v_d := p_delta * coalesce(v_factor, 1);
    update public.stock_items set stock = stock + v_d where id = v_si returning stock, name into v_stock, v_si_name;
    insert into public.stock_movements (product_id, product_name, delta, stock_after, reason, note, order_id, order_no, stock_item_id, stock_item_name)
    values (p_product, v_name, v_d, v_stock, p_reason, p_note, p_order, p_order_no, v_si, v_si_name);
  end if;
  return v_stock;
end $$;

create or replace function private.apply_pool_stock(p_si uuid, p_delta int, p_reason text, p_note text)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_stock int; v_name text;
begin
  if p_delta = 0 then select stock into v_stock from public.stock_items where id = p_si; return v_stock; end if;
  update public.stock_items set stock = stock + p_delta where id = p_si returning stock, name into v_stock, v_name;
  if not found then raise exception 'Stock item not found'; end if;
  insert into public.stock_movements (product_id, product_name, delta, stock_after, reason, note, stock_item_id, stock_item_name)
  values (null, v_name, p_delta, v_stock, p_reason, p_note, p_si, v_name);
  return v_stock;
end $$;

create or replace function public.adjust_stock_item(p_stock_item_id uuid, p_delta int, p_reason text default 'correction', p_note text default null)
returns int language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  if p_reason not in ('restock','waste','correction','initial') then raise exception 'Invalid reason %', p_reason; end if;
  return private.apply_pool_stock(p_stock_item_id, p_delta, p_reason, nullif(btrim(p_note), ''));
end $$;

create or replace function public.set_stock_item(p_stock_item_id uuid, p_value int, p_reason text default 'correction', p_note text default null)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_cur int;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  if p_reason not in ('restock','waste','correction','initial') then raise exception 'Invalid reason %', p_reason; end if;
  select stock into v_cur from public.stock_items where id = p_stock_item_id for update;
  if not found then raise exception 'Stock item not found'; end if;
  return private.apply_pool_stock(p_stock_item_id, p_value - v_cur, p_reason, coalesce(nullif(btrim(p_note), ''), 'Set to ' || p_value));
end $$;

-- adjust_stock / set_stock on a linked product act on its shared pool
create or replace function public.adjust_stock(p_product_id uuid, p_delta int, p_reason text default 'correction', p_note text default null)
returns int language plpgsql security invoker set search_path = '' as $$
declare v int;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  if p_reason not in ('restock','waste','correction','initial') then raise exception 'Invalid reason %', p_reason; end if;
  v := private.apply_stock(p_product_id, p_delta, p_reason, nullif(btrim(p_note), ''), null, null);
  if v is null then
    select coalesce(si.stock, p.stock) into v from public.products p left join public.stock_items si on si.id = p.stock_item_id where p.id = p_product_id;
  end if;
  return v;
end $$;

create or replace function public.set_stock(p_product_id uuid, p_value int, p_reason text default 'correction', p_note text default null)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_cur int; v int; v_si uuid;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  if p_reason not in ('restock','waste','correction','initial') then raise exception 'Invalid reason %', p_reason; end if;
  select stock, stock_item_id into v_cur, v_si from public.products where id = p_product_id for update;
  if not found then raise exception 'Item not found'; end if;
  if v_si is not null then return public.set_stock_item(v_si, p_value, p_reason, p_note); end if;
  v := private.apply_stock(p_product_id, p_value - v_cur, p_reason, coalesce(nullif(btrim(p_note), ''), 'Set to ' || p_value), null, null);
  return coalesce(v, v_cur);
end $$;

revoke all on function private.apply_pool_stock(uuid, int, text, text) from public, anon;
grant execute on function private.apply_pool_stock(uuid, int, text, text) to authenticated;
revoke all on function public.adjust_stock_item(uuid, int, text, text) from public, anon;
revoke all on function public.set_stock_item(uuid, int, text, text) from public, anon;
grant execute on function public.adjust_stock_item(uuid, int, text, text) to authenticated;
grant execute on function public.set_stock_item(uuid, int, text, text) to authenticated;

-- ---------- realtime ----------
alter table public.stock_items replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.stock_items; exception when duplicate_object then null; end;
end $$;

-- ---------- seed: Frozen Momos pool (stock 0), link Steamed + Fried, exact prices ----------
select set_config('vegpos.audit_note', 'v4 migration: shared Frozen Momos stock', true);
insert into public.stock_items (name, unit, stock, sort_order) values ('Frozen Momos', 'pcs', 0, 1) on conflict (name) do nothing;
update public.products set stock_item_id = (select id from public.stock_items where name = 'Frozen Momos'), stock_factor = 1
 where name in ('Veg Momos Steamed', 'Veg Momos Fried') and stock_item_id is null;
update public.products set variants = '[{"label":"8pcs","price":10,"pieces":8},{"label":"12pcs","price":15,"pieces":12},{"label":"16pcs","price":20,"pieces":16}]'::jsonb
 where name = 'Veg Momos Steamed' and variants is distinct from '[{"label":"8pcs","price":10,"pieces":8},{"label":"12pcs","price":15,"pieces":12},{"label":"16pcs","price":20,"pieces":16}]'::jsonb;
update public.products set variants = '[{"label":"8pcs","price":12,"pieces":8},{"label":"12pcs","price":18,"pieces":12},{"label":"16pcs","price":23,"pieces":16}]'::jsonb
 where name = 'Veg Momos Fried' and variants is distinct from '[{"label":"8pcs","price":12,"pieces":8},{"label":"12pcs","price":18,"pieces":12},{"label":"16pcs","price":23,"pieces":16}]'::jsonb;
