-- vegpos_v7c_points_lookup_and_rpc_hardening (additive)
-- 1) Number-only loyalty points lookup for the customer app.
-- 2) Public (anon) SECURITY DEFINER RPCs move to an unexposed schema; public keeps thin SECURITY INVOKER
--    wrappers with identical signatures, so the Data API surface is unchanged (clears advisor 0028/0029).
-- 3) get_checkout_quote no longer returns a points balance (that is get_points_balance's only job).

create schema if not exists customer_api;
revoke all on schema customer_api from public;
grant usage on schema customer_api to anon, authenticated, service_role;

-- move the existing definer functions (bodies + grants unchanged; all use fully-qualified names, search_path '')
alter function public.get_public_menu() set schema customer_api;
alter function public.get_public_info() set schema customer_api;
alter function public.get_checkout_quote(jsonb, text, text) set schema customer_api;
alter function public.place_customer_order(text, text, timestamptz, jsonb, text, text) set schema customer_api;

-- quote: subtotal / promo / estimated points earned only (no balance)
create or replace function customer_api.get_checkout_quote(p_items jsonb default null, p_promo_code text default null, p_phone text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.settings; v_sub numeric := 0; v_line jsonb; v_var jsonb; v_prod record; v_q int; p public.promotions; v_msg text;
        v_disc numeric := 0; v_promo jsonb := null; v_code text := upper(btrim(coalesce(p_promo_code, '')));
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
  return jsonb_build_object('subtotal', v_sub, 'discount', v_disc, 'total', greatest(v_sub - v_disc, 0), 'promo', v_promo,
    'earn', case when s.loyalty_enabled then floor(greatest(v_sub - v_disc, 0) * s.loyalty_earn_per_dollar)::int else 0 end);
end $$;

-- points balance: returns ONLY an integer (null when the phone is invalid or loyalty is off; 0 when unknown)
create or replace function customer_api.get_points_balance(p_phone text)
returns integer language sql stable security definer set search_path = '' as $$
  select case when not s.loyalty_enabled or private.norm_phone(p_phone) is null or char_length(coalesce(p_phone, '')) > 30 then null
              else coalesce((select c.points from public.customers c where c.phone = private.norm_phone(p_phone)), 0) end
  from public.settings s where s.id = 1;
$$;

revoke all on all functions in schema customer_api from public;
grant execute on all functions in schema customer_api to anon, authenticated, service_role;

-- thin invoker wrappers in the exposed schema (same names / args / defaults as before)
create function public.get_public_menu()
returns table(id uuid, name text, category text, sort_order integer, in_stock boolean, variants jsonb)
language sql stable security invoker set search_path = '' as $$ select * from customer_api.get_public_menu(); $$;
create function public.get_public_info()
returns jsonb language sql stable security invoker set search_path = '' as $$ select customer_api.get_public_info(); $$;
create function public.get_checkout_quote(p_items jsonb default null, p_promo_code text default null, p_phone text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$ select customer_api.get_checkout_quote(p_items, p_promo_code, p_phone); $$;
create function public.get_points_balance(p_phone text)
returns integer language sql stable security invoker set search_path = '' as $$ select customer_api.get_points_balance(p_phone); $$;
create function public.place_customer_order(p_customer_name text, p_customer_phone text default null, p_pickup_time timestamptz default null,
  p_items jsonb default null, p_notes text default null, p_promo_code text default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select customer_api.place_customer_order(p_customer_name, p_customer_phone, p_pickup_time, p_items, p_notes, p_promo_code);
$$;
comment on function public.place_customer_order(text, text, timestamptz, jsonb, text, text) is
  'VegPOS v7c: public wrapper for customer_api.place_customer_order (server prices, stock, hours/notice/days from settings, promo, guards).';
comment on function public.get_points_balance(text) is 'VegPOS v7c: loyalty points balance for a phone number. Returns only an integer.';

revoke all on function public.get_public_menu(), public.get_public_info(), public.get_checkout_quote(jsonb, text, text),
  public.get_points_balance(text), public.place_customer_order(text, text, timestamptz, jsonb, text, text) from public;
grant execute on function public.get_public_menu(), public.get_public_info(), public.get_checkout_quote(jsonb, text, text),
  public.get_points_balance(text), public.place_customer_order(text, text, timestamptz, jsonb, text, text) to anon, authenticated, service_role;
