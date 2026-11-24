-- Fase 6: recordatorio diario opcional para apuntar gastos (a la hora elegida, en la zona horaria de cada persona).
alter table public.notification_prefs
  add column daily_reminder boolean not null default false,
  add column reminder_hour smallint not null default 21 check (reminder_hour between 0 and 23),
  add column timezone text not null default 'Europe/Madrid' check (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$' and char_length(timezone) <= 64);

-- Cada hora Supabase llama a la ruta protegida con CRON_SECRET (pg_cron + pg_net). La URL y el secreto viven en Vault, nunca en el código.
create extension if not exists pg_net with schema extensions;

create or replace function public.call_reminders()
returns void language plpgsql security definer set search_path = public, extensions, vault, pg_temp
as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then return; end if; -- sin configurar: no hace nada
  perform net.http_get(url := v_url || '/api/cron/reminders', headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret), timeout_milliseconds := 8000);
end $$;
revoke all on function public.call_reminders() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('fifti-reminders', '0 * * * *', 'select public.call_reminders()');
  end if;
end $$;
