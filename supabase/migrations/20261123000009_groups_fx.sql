-- Fase 9: tipos de cambio (caché diaria) y archivado de planes.

create table public.fx_rates (
  day date not null,
  base char(3) not null check (base ~ '^[A-Z]{3}$'),   -- moneda del gasto
  quote char(3) not null check (quote ~ '^[A-Z]{3}$'), -- moneda base del espacio
  rate numeric(18, 8) not null check (rate > 0 and rate < 1000000),
  fetched_at timestamptz not null default now(),
  primary key (day, base, quote)
);
-- Sin políticas: solo el servidor (service_role) lee y escribe la caché.
alter table public.fx_rates enable row level security;
alter table public.fx_rates force row level security;
revoke all on public.fx_rates from anon, authenticated;

-- Las burbujas personales no se archivan
alter table public.spaces add constraint spaces_personal_not_archived check (kind <> 'personal' or archived_at is null);
