-- v11 (PREPARED — NOT APPLIED): two-way WhatsApp. Staff reply "Accept"/"Accepted" (button or text) → order Accepted.
-- Requires v9 (20261104070000_v9_whatsapp_cloud_notify_PREPARED.sql: public.notification_log) and v10 (status 'accepted').
-- Additive only: widens a check constraint, adds an index and one function. No rows are changed by this migration.

-- notification_log also records inbound WhatsApp messages and our short replies
alter table public.notification_log drop constraint if exists notification_log_status_check;
alter table public.notification_log add constraint notification_log_status_check
  check (status in ('sent', 'error', 'skipped', 'dry_run', 'received', 'ignored'));
-- Meta retries webhooks: one row per inbound wamid makes processing idempotent
create unique index if not exists notification_log_inbound_wamid_uq
  on public.notification_log (provider_message_id) where status in ('received', 'ignored') and provider_message_id is not null;
create index if not exists notification_log_provider_msg_idx on public.notification_log (provider_message_id);

-- Accept an order from the staff WhatsApp number. Called ONLY by the whatsapp-webhook Edge Function (service role).
-- Defence in depth: re-checks that p_from is the Settings staff number. Only 'pending' → 'accepted'.
-- The orders audit trigger (vegpos_audit) writes the audit_log row; the note says it came from WhatsApp.
create or replace function public.wa_accept_order(p_order_id uuid, p_from text, p_inbound_wamid text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare o public.orders; v_staff text;
begin
  select staff_whatsapp into v_staff from public.settings where id = 1;
  if private.norm_phone(v_staff) is null or private.norm_phone(p_from) is distinct from private.norm_phone(v_staff) then
    return jsonb_build_object('ok', false, 'result', 'not_staff');
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'result', 'not_found'); end if;
  if o.status <> 'pending' then
    return jsonb_build_object('ok', o.status in ('accepted', 'preparing', 'ready', 'completed'), 'result',
      case when o.status = 'cancelled' then 'cancelled' else 'already' end, 'order_no', o.order_no, 'status', o.status);
  end if;
  perform set_config('vegpos.audit_note', left(format('Accepted via WhatsApp reply from +%s (msg %s)',
    regexp_replace(coalesce(p_from, ''), '[^0-9]', '', 'g'), coalesce(p_inbound_wamid, '-')), 300), true);
  update public.orders set status = 'accepted', completed_at = null, cancelled_at = null where id = p_order_id returning * into o;
  return jsonb_build_object('ok', true, 'result', 'accepted', 'order_no', o.order_no, 'status', o.status);
end $function$;
revoke all on function public.wa_accept_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.wa_accept_order(uuid, text, text) to service_role;
