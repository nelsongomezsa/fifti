-- Antelación del aviso de gasto fijo: 1, 3 o 7 días.
alter table public.notification_prefs add column fixed_advance_days smallint not null default 1 check (fixed_advance_days in (1, 3, 7));
