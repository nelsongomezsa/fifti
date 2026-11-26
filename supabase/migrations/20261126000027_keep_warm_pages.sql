-- Cada pantalla es su propia función en Vercel (y el proxy otra más): un ping a una sola ruta no calienta el resto.
-- Cada 5 minutos se piden la ruta barata y las pantallas de la barra con la cookie de la demo: así pasan por el proxy y por
-- la función real de cada pantalla, pero sin sesión, sin datos de nadie y sin tocar la base de datos.
do $$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  perform cron.unschedule('keep-warm') where exists (select 1 from cron.job where jobname = 'keep-warm');
  perform cron.schedule('keep-warm', '*/5 * * * *', $job$
    select net.http_get(url := 'https://fifti-seven.vercel.app/api/ping', timeout_milliseconds := 10000);
    select net.http_get(url := 'https://fifti-seven.vercel.app/login', timeout_milliseconds := 10000);
    select net.http_get(url := 'https://fifti-seven.vercel.app/' || p, headers := '{"Cookie": "fifti_demo=1"}'::jsonb, timeout_milliseconds := 15000)
      from unnest(array['inicio', 'movimientos', 'calendario', 'plan', 'cuentas', 'ajustes']) as p;
  $job$);
exception when others then
  raise notice 'keep-warm no se ha programado: %', sqlerrm;
end $$;
