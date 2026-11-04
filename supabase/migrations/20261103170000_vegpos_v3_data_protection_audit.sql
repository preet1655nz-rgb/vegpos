-- VegPOS v3: data protection. Additive only: no tables or columns with data are dropped.
-- 1) Soft-delete only (no client DELETE on orders/products/stock_movements)
-- 2) DELETE/TRUNCATE guard triggers (only postgres/service_role/supabase_admin may bypass)
-- 3) Append-only audit_log filled by SECURITY DEFINER triggers
-- 4) Locked orders

-- ---------- helpers ----------
-- note: called from invoker triggers, so authenticated keeps EXECUTE (it only reads current_user)
create or replace function private.is_admin_role()
returns boolean language sql stable set search_path = '' as $$
  select current_user in ('postgres', 'service_role', 'supabase_admin');
$$;

-- ---------- 1) policies: replace FOR ALL with select/insert/update ----------
drop policy if exists staff_all_products on public.products;
drop policy if exists staff_all_orders on public.orders;
create policy staff_read_products on public.products for select to authenticated using ((select private.is_staff()));
create policy staff_insert_products on public.products for insert to authenticated with check ((select private.is_staff()));
create policy staff_update_products on public.products for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy staff_read_orders on public.orders for select to authenticated using ((select private.is_staff()));
create policy staff_insert_orders on public.orders for insert to authenticated with check ((select private.is_staff()));
create policy staff_update_orders on public.orders for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

revoke delete, truncate on public.orders, public.products, public.stock_movements from anon, authenticated;
revoke update on public.stock_movements from anon, authenticated;
revoke delete, truncate on public.settings from anon, authenticated;
revoke truncate on public.staff from anon, authenticated;

-- ---------- 2) delete / truncate guard ----------
create or replace function private.block_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_admin_role() then
    return case when tg_level = 'ROW' then old else null end;
  end if;
  raise exception 'VEGPOS_PROTECTED: % rows cannot be deleted (use cancel/archive instead)', tg_table_name
    using errcode = '42501';
end $$;

do $$ declare t text; begin
  foreach t in array array['orders', 'products', 'stock_movements'] loop
    execute format('drop trigger if exists vegpos_block_delete on public.%I', t);
    execute format('create trigger vegpos_block_delete before delete on public.%I for each row execute function private.block_delete()', t);
    execute format('drop trigger if exists vegpos_block_truncate on public.%I', t);
    execute format('create trigger vegpos_block_truncate before truncate on public.%I for each statement execute function private.block_delete()', t);
  end loop;
end $$;

-- ---------- 3) audit log ----------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb,
  actor_id uuid,
  actor_email text,
  db_role text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_table_row_idx on public.audit_log (table_name, row_id);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
create policy staff_read_audit on public.audit_log for select to authenticated using ((select private.is_staff()));

create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_new jsonb; v_old jsonb; v_claims jsonb;
begin
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  insert into public.audit_log (table_name, row_id, action, old_row, new_row, actor_id, actor_email, db_role, note)
  values (tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'email', v_old ->> 'email'),
    tg_op, v_old, v_new,
    nullif(v_claims ->> 'sub', '')::uuid,
    v_claims ->> 'email',
    coalesce(v_claims ->> 'role', session_user::text),
    nullif(current_setting('vegpos.audit_note', true), ''));
  return null;
end $$;
revoke all on function private.audit_row() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['orders', 'products', 'stock_movements', 'staff', 'settings'] loop
    execute format('drop trigger if exists vegpos_audit on public.%I', t);
    execute format('create trigger vegpos_audit after insert or update or delete on public.%I for each row execute function private.audit_row()', t);
  end loop;
end $$;

create or replace function private.audit_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'postgres' then
    return case when tg_level = 'ROW' then coalesce(new, old) else null end;
  end if;
  raise exception 'VEGPOS_PROTECTED: audit_log is append-only' using errcode = '42501';
end $$;
drop trigger if exists vegpos_audit_append_only on public.audit_log;
create trigger vegpos_audit_append_only before update or delete on public.audit_log
  for each row execute function private.audit_append_only();
drop trigger if exists vegpos_audit_no_truncate on public.audit_log;
create trigger vegpos_audit_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_append_only();

-- ---------- 4) locked orders ----------
alter table public.orders add column if not exists locked boolean not null default false;

create or replace function private.order_lock_guard()
returns trigger language plpgsql set search_path = '' as $$
declare keep text[] := array['status', 'paid', 'completed_at', 'cancelled_at', 'updated_at', 'locked'];
begin
  if private.is_admin_role() then return new; end if;
  if new.locked is distinct from old.locked and not private.is_owner() then
    raise exception 'VEGPOS_LOCKED: only the owner can lock or unlock orders' using errcode = '42501';
  end if;
  if old.locked then
    if not new.locked then
      -- unlocking: nothing else may change in the same update
      if (to_jsonb(new) - array['locked', 'updated_at']) <> (to_jsonb(old) - array['locked', 'updated_at']) then
        raise exception 'VEGPOS_LOCKED: unlock order #% first, then edit it', old.order_no using errcode = '42501';
      end if;
    else
      if new.status = 'cancelled' and old.status <> 'cancelled' then
        raise exception 'VEGPOS_LOCKED: order #% is locked and cannot be cancelled', old.order_no using errcode = '42501';
      end if;
      if (to_jsonb(new) - keep) <> (to_jsonb(old) - keep) then
        raise exception 'VEGPOS_LOCKED: order #% is locked; only status and payment can change', old.order_no using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists vegpos_order_lock_guard on public.orders;
create trigger vegpos_order_lock_guard before update on public.orders
  for each row execute function private.order_lock_guard();

revoke all on function private.block_delete(), private.audit_append_only(), private.order_lock_guard() from public, anon;
