-- Interpretar frases con IA: desactivado por defecto; solo lo cambia la propia persona.
alter table public.profiles add column ai_phrases boolean not null default false;
grant update (ai_phrases) on public.profiles to authenticated;
