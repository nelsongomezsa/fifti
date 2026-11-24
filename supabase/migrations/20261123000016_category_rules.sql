-- Fase 3: reglas automáticas de categoría (por burbuja) y pistas para aprenderlas.

create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  match_text text not null check (char_length(match_text) between 1 and 60 and match_text = btrim(match_text)),
  match_type text not null default 'contains' check (match_type in ('contains', 'starts_with', 'exact')),
  category_id uuid not null references public.categories (id) on delete cascade,
  fund_id uuid references public.funds (id) on delete set null,
  priority integer not null default 100 check (priority between 0 and 100000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index category_rules_space_idx on public.category_rules (space_id, priority);

-- La categoría (y el fondo) de una regla tienen que ser de la misma burbuja
create or replace function public.check_rule_refs()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.categories c where c.id = new.category_id and c.space_id = new.space_id) then
    raise exception 'La categoría no pertenece a esta burbuja' using errcode = '23514';
  end if;
  if new.fund_id is not null and not exists (select 1 from public.funds f where f.id = new.fund_id and f.space_id = new.space_id) then
    raise exception 'El fondo no pertenece a esta burbuja' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger category_rules_refs before insert or update on public.category_rules
  for each row execute function public.check_rule_refs();

alter table public.category_rules enable row level security;
alter table public.category_rules force row level security;
create policy category_rules_select on public.category_rules for select to authenticated using (public.is_member(space_id));
create policy category_rules_write on public.category_rules for all to authenticated
  using (public.is_full_member(space_id)) with check (public.is_full_member(space_id));
grant select, insert, update, delete on public.category_rules to authenticated;

-- Pistas de aprendizaje: cuántas veces ha corregido una persona la categoría de un concepto. Solo las ve quien las crea.
create table public.rule_hints (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  text_key text not null check (char_length(text_key) between 1 and 60),
  category_id uuid not null references public.categories (id) on delete cascade,
  hits integer not null default 1 check (hits >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, space_id, text_key, category_id)
);
alter table public.rule_hints enable row level security;
alter table public.rule_hints force row level security;
create policy rule_hints_own on public.rule_hints for select to authenticated using (user_id = auth.uid());
grant select on public.rule_hints to authenticated;

create or replace function public.bump_rule_hint(p_space uuid, p_text text, p_category uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_hits integer; v_key text := left(btrim(p_text), 60);
begin
  if auth.uid() is null or not public.is_full_member(p_space) or v_key = '' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if not exists (select 1 from public.categories where id = p_category and space_id = p_space) then raise exception 'Categoría no válida' using errcode = '23514'; end if;
  insert into public.rule_hints (user_id, space_id, text_key, category_id) values (auth.uid(), p_space, v_key, p_category)
  on conflict (user_id, space_id, text_key, category_id) do update set hits = public.rule_hints.hits + 1, updated_at = now()
  returning hits into v_hits;
  return v_hits;
end $$;
revoke all on function public.bump_rule_hint(uuid, text, uuid) from public, anon;
grant execute on function public.bump_rule_hint(uuid, text, uuid) to authenticated;
