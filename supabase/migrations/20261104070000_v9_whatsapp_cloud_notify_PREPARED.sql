-- v9 (PREPARED — NOT APPLIED): automatic WhatsApp Cloud API alert to the staff/owner number on every new order.
-- Additive only: new extension, new log table, new trigger function + AFTER INSERT trigger. No existing data is changed.
-- Safe by default: the trigger does nothing until the Vault secret 'notify_new_order_secret' exists,
-- and it never blocks or fails an order insert (all errors are swallowed; pg_net is asynchronous).
-- Switch-on steps: supabase/functions/notify-new-order/README.md

create extension if not exists pg_net with schema extensions;

-- delivery log (one row per attempt); staff can read it, only the Edge Function (service role) writes
create table if not exists public.notification_log (
  id bigint generated always as identity primary key,
  order_id uuid references public.orders(id),
  channel text not null default 'whatsapp_cloud',
  recipient text,
  status text not null check (status in ('sent','error','skipped','dry_run')),
  provider_message_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists notification_log_order_idx on public.notification_log(order_id, channel, status);
alter table public.notification_log enable row level security;
drop policy if exists staff_read_notification_log on public.notification_log;
create policy staff_read_notification_log on public.notification_log for select to authenticated using ((select private.is_staff()));
revoke all on public.notification_log from anon;
grant select on public.notification_log to authenticated;

create or replace function private.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_new_order_secret' limit 1;
  if v_secret is null or v_secret = '' then
    return null; -- not switched on yet
  end if;
  perform net.http_post(
    url     := 'https://sjjesqyqaikivonjuxfs.supabase.co/functions/v1/notify-new-order',
    body    := jsonb_build_object('order_id', new.id),
    headers := jsonb_build_object('content-type', 'application/json', 'x-notify-secret', v_secret),
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  raise warning 'notify_new_order skipped for order %: %', new.id, sqlerrm;
  return null; -- never block an order
end;
$$;
revoke all on function private.notify_new_order() from public, anon, authenticated;

drop trigger if exists vegpos_notify_new_order on public.orders;
create trigger vegpos_notify_new_order
  after insert on public.orders
  for each row execute function private.notify_new_order();

-- To pause later without dropping anything:  alter table public.orders disable trigger vegpos_notify_new_order;
