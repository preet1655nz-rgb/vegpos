-- v10: two working stages — New (pending, customer orders only) → Accepted → Completed (+ Cancelled).
-- Additive: 'accepted' is ADDED to the allowed statuses; legacy 'preparing'/'ready' stay valid (locked order #7 keeps its
-- value untouched; the staff app shows legacy values as "Accepted"). No rows are updated by this migration.

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status = any (array['pending','accepted','preparing','ready','completed','cancelled']));

-- set_order_status: same behaviour, plus 'accepted'
create or replace function public.set_order_status(p_order_id uuid, p_status text)
 returns public.orders
 language plpgsql
 set search_path to ''
as $function$
declare v_old public.orders; v_new public.orders; r record;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  if p_status not in ('pending','accepted','preparing','ready','completed','cancelled') then raise exception 'Invalid status %', p_status; end if;
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
end $function$;

-- save_order: identical except a NEW staff-entered order starts as 'accepted' (customer-app orders still start 'pending')
create or replace function public.save_order(p_order_id uuid, p_customer_name text, p_customer_phone text, p_pickup_time timestamp with time zone, p_items jsonb, p_notes text default null::text, p_payment_method text default null::text, p_paid boolean default false, p_discount numeric default 0)
 returns public.orders
 language plpgsql
 set search_path to ''
as $function$
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
            p_payment_method, coalesce(p_paid, false), least(coalesce(p_discount, 0), v_sub), v_sub, v_total, 'accepted')
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
end $function$;

-- complete_order: one tap = paid in cash (if not yet paid; same path as "Paid cash", so loyalty points / tip / audit
-- behave exactly as before) + status completed. Optional cash received / keep-as-tip from the "Cash received…" sheet.
create or replace function public.complete_order(p_order_id uuid, p_cash_received numeric default null, p_keep_tip boolean default false)
 returns public.orders
 language plpgsql
 set search_path to ''
as $function$
declare o public.orders;
begin
  if not private.is_staff() then raise exception 'Not authorised'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then raise exception 'This order is cancelled'; end if;
  if not o.paid then
    if o.locked then
      update public.orders set paid = true where id = p_order_id returning * into o;  -- locked: only status/paid may change
    else
      o := public.mark_order_paid_cash(p_order_id, p_cash_received, p_keep_tip);
    end if;
  end if;
  if o.status <> 'completed' then
    o := public.set_order_status(p_order_id, 'completed');
  end if;
  return o;
end $function$;
revoke all on function public.complete_order(uuid, numeric, boolean) from public, anon;
grant execute on function public.complete_order(uuid, numeric, boolean) to authenticated, service_role;
