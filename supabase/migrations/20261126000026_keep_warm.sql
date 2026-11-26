-- Mantiene caliente la función de Vercel: pg_cron llama cada 5 minutos a una ruta que no hace nada (sin coste en Vercel Hobby,
-- porque el cron vive en Supabase). Si las extensiones no estuvieran disponibles, la migración no falla.
do $$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  perform cron.unschedule('keep-warm') where exists (select 1 from cron.job where jobname = 'keep-warm');
  perform cron.schedule('keep-warm', '*/5 * * * *', $job$select net.http_get(url := 'https://fifti-seven.vercel.app/api/ping')$job$);
exception when others then
  raise notice 'keep-warm no se ha programado: %', sqlerrm;
end $$;
