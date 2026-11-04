-- vegpos_v7b_fix_notice_message: fix operator precedence in the notice message
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
      private.fmt_hm(((now() + make_interval(mins => s.min_notice_minutes)) at time zone 'Pacific/Auckland')::time);
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
