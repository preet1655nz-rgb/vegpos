-- v8: staff/owner WhatsApp number for the staff app's "WhatsApp staff" button. Additive only.
alter table public.settings add column if not exists staff_whatsapp text;
alter table public.settings drop constraint if exists settings_staff_whatsapp_len;
alter table public.settings add constraint settings_staff_whatsapp_len check (staff_whatsapp is null or char_length(staff_whatsapp) <= 24);
comment on column public.settings.staff_whatsapp is 'Staff/owner WhatsApp number used by the staff app "WhatsApp staff" button (staff-only; not exposed by get_public_info).';
