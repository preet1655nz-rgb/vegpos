-- v13 (applied): staff app Web Push. Phones/desktops that tapped "Enable alerts" get a system notification for every
-- new customer-app order, even with the app closed. Additive only; no hard deletes (dead subscriptions are soft-revoked).
-- Secrets (VAPID private key, webhook shared secret) live in Supabase Vault, inserted out-of-band, never in this repo.

create extension if not exists pg_net;  -- async HTTP from Postgres (used only by the trigger below)

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  endpoint    text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh      text not null check (length(p256dh) between 20 and 200),
  auth        text not null check (length(auth) between 8 and 100),
  staff_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  user_agent  text check (length(user_agent) <= 400),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  last_error  text,
  fail_count  int not null default 0,
  revoked_at  timestamptz          -- set on 404/410 from the push service (or when a device turns alerts off)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_staff_select on public.push_subscriptions;
drop policy if exists push_subs_staff_insert on public.push_subscriptions;
drop policy if exists push_subs_staff_update on public.push_subscriptions;
create policy push_subs_staff_select on public.push_subscriptions for select to authenticated using (private.is_staff());
create policy push_subs_staff_insert on public.push_subscriptions for insert to authenticated with check (private.is_staff());
create policy push_subs_staff_update on public.push_subscriptions for update to authenticated using (private.is_staff()) with check (private.is_staff());
revoke all on public.push_subscriptions from anon;
grant select, insert, update on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
drop trigger if exists vegpos_block_delete on public.push_subscriptions;
create trigger vegpos_block_delete before delete on public.push_subscriptions for each row execute function private.block_delete();

-- staff device registers (or re-activates) its subscription
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth, staff_email, user_agent)
  values (p_endpoint, p_p256dh, p_auth, lower(coalesce(auth.jwt() ->> 'email', '')), left(p_user_agent, 400))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, staff_email = excluded.staff_email,
     user_agent = excluded.user_agent, updated_at = now(), revoked_at = null, fail_count = 0, last_error = null
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'active', (select count(*) from public.push_subscriptions where revoked_at is null));
end $$;
create or replace function public.revoke_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  update public.push_subscriptions set revoked_at = now(), updated_at = now(), last_error = 'turned off on device' where endpoint = p_endpoint and revoked_at is null;
end $$;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.revoke_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.revoke_push_subscription(text) to authenticated;

-- config for the push-new-order Edge Function (service_role only). Its own env vars win when set.
create or replace function public.push_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'vapid_public',   (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public_key'),
    'vapid_private',  (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key'),
    'webhook_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_new_order_secret'));
$$;
revoke all on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

-- AFTER INSERT on orders -> pg_net POST to the Edge Function (customer-app orders = status 'pending').
-- Never blocks or fails the order: any problem is swallowed with a warning.
create or replace function private.push_new_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_url text;
begin
  if new.status is distinct from 'pending' then return new; end if;
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_new_order_secret';
    select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'push_new_order_url';
    if v_secret is null or v_url is null then return new; end if;
    perform net.http_post(url := v_url,
      body := jsonb_build_object('type', 'INSERT', 'order_id', new.id, 'order_no', new.order_no),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      timeout_milliseconds := 8000);
  exception when others then
    raise warning 'push_new_order: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function private.push_new_order() from public, anon, authenticated;
drop trigger if exists vegpos_push_new_order on public.orders;
create trigger vegpos_push_new_order after insert on public.orders for each row execute function private.push_new_order();
