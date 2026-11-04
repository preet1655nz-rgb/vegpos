-- vegpos_v5_public_customer_ordering
-- Additive only: two public SECURITY DEFINER RPCs for the customer ordering app.
-- No table grants / RLS policies are changed; anon still cannot touch any table directly.

create or replace function public.get_public_menu()
returns table (id uuid, name text, category text, sort_order integer, in_stock boolean, variants jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select pr.id, pr.name, pr.category, pr.sort_order, pr.product_no, pr.variants,
           case when pr.stock_item_id is null then pr.stock else coalesce(si.stock, 0) end as avail,
           case when pr.stock_item_id is null then 1 else pr.stock_factor end as factor,
           (pr.stock_item_id is not null and coalesce(si.archived, true)) as pool_off
    from public.products pr
    left join public.stock_items si on si.id = pr.stock_item_id
    where pr.active and not pr.archived
  ),
  v as (
    select p.id,
           jsonb_agg(jsonb_build_object(
             'index', (e.ord - 1)::int,
             'label', e.v ->> 'label',
             'price', (e.v ->> 'price')::numeric,
             'available', (not p.pool_off and p.avail >=
                 greatest(case when (e.v ->> 'pieces') ~ '^[0-9]{1,6}$' then (e.v ->> 'pieces')::int else 0 end, 0) * p.factor)
           ) order by e.ord) as variants
    from p
    cross join lateral jsonb_array_elements(p.variants) with ordinality as e(v, ord)
    where jsonb_typeof(e.v) = 'object'
      and coalesce(btrim(e.v ->> 'label'), '') <> ''
      and (e.v ->> 'price') ~ '^[0-9]+(\.[0-9]+)?$'
    group by p.id
  )
  select p.id, p.name, p.category, p.sort_order,
         coalesce((select bool_or((x ->> 'available')::boolean) from jsonb_array_elements(v.variants) x), false) as in_stock,
         v.variants
  from p
  join v on v.id = p.id
  order by p.sort_order, p.product_no;
$$;

comment on function public.get_public_menu() is
  'VegPOS v5: public (anon) menu for the customer app. Active, non-archived products; variant label/price/available only. No stock counts.';

create or replace function public.place_customer_order(
  p_customer_name text,
  p_customer_phone text default null,
  p_pickup_time timestamptz default null,
  p_items jsonb default null,
  p_notes text default null
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
begin
  -- ---- customer details ----
  if v_name = '' then raise exception 'Please enter your name'; end if;
  if char_length(v_name) > 80 then raise exception 'Name must be 80 characters or fewer'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{6,20}$' then
    raise exception 'Phone number looks invalid (digits, spaces, + ( ) - only, max 20 characters)';
  end if;
  if v_notes is not null and char_length(v_notes) > 300 then raise exception 'Notes must be 300 characters or fewer'; end if;

  -- ---- pickup time ----
  if p_pickup_time is null then raise exception 'Pickup time is required'; end if;
  if p_pickup_time < now() - interval '5 minutes' then raise exception 'Pickup time cannot be in the past'; end if;
  if p_pickup_time > now() + interval '14 days' then raise exception 'Pickup time must be within the next 14 days'; end if;

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
                             paid, discount, subtotal, total, status, created_by)
  values (v_name, v_phone, p_pickup_time, v_items, v_notes, null,
          false, 0, v_sub, v_sub, 'pending', 'customer-app')
  returning * into v_order;

  for r in select * from private.piece_map(v_items) loop
    perform private.apply_stock(r.product_id, -r.pieces, 'order', 'customer-app', v_order.id, v_order.order_no);
  end loop;

  return jsonb_build_object('order_no', v_order.order_no, 'total', v_order.total,
                            'pickup_time', v_order.pickup_time, 'status', v_order.status);
end
$$;

comment on function public.place_customer_order(text, text, timestamptz, jsonb, text) is
  'VegPOS v5: public (anon) customer order. Server-side prices, validated, stock checked + deducted atomically (pieces x stock_factor for pooled stock).';

revoke all on function public.get_public_menu() from public, anon, authenticated;
revoke all on function public.place_customer_order(text, text, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.get_public_menu() to anon, authenticated, service_role;
grant execute on function public.place_customer_order(text, text, timestamptz, jsonb, text) to anon, authenticated, service_role;
