-- Fase 1: perfiles, espacios, miembros, rate limiting y registro de auditoría.
-- Dinero siempre en céntimos (bigint); porcentajes en puntos básicos.

create extension if not exists pgcrypto;

-- ───────── Tipos ─────────
create type public.space_kind as enum ('personal', 'household', 'group');
create type public.member_role as enum ('owner', 'member', 'guest');

-- ───────── Perfiles ─────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_color text not null default '#C6F432' check (avatar_color ~ '^#[0-9A-Fa-f]{6}$'),
  locale text not null default 'es' check (locale in ('es', 'en')),
  discreet_mode boolean not null default false,
  created_at timestamptz not null default now()
);

-- ───────── Espacios (burbujas) ─────────
create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  kind public.space_kind not null,
  base_currency char(3) not null default 'EUR' check (base_currency ~ '^[A-Z]{3}$'),
  emoji text check (emoji is null or char_length(emoji) <= 8),
  starts_on date,
  ends_on date,
  archived_at timestamptz,
  daily_budget_cents bigint check (daily_budget_cents is null or daily_budget_cents > 0),
  template text check (template is null or template in ('night', 'dinner', 'trip', 'flat')),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
-- Un solo espacio personal por usuario
create unique index spaces_one_personal_per_user on public.spaces (created_by) where kind = 'personal';

-- ───────── Miembros (con cuenta o virtuales) ─────────
create table public.space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  role public.member_role not null default 'member',
  default_share_bp integer check (default_share_bp is null or default_share_bp between 0 and 10000),
  claim_token_hash text,
  claim_expires_at timestamptz,
  joined_at timestamptz not null default now()
);
create unique index space_members_unique_user on public.space_members (space_id, user_id) where user_id is not null;
create index space_members_user_idx on public.space_members (user_id);
create index space_members_space_idx on public.space_members (space_id);

-- ───────── Funciones de pertenencia ─────────
-- security definer + search_path fijo: evitan recursión de RLS y secuestro de funciones.
create or replace function public.is_member(p_space uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.space_members
    where space_id = p_space and user_id = auth.uid()
  );
$$;

create or replace function public.is_owner(p_space uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.space_members
    where space_id = p_space and user_id = auth.uid() and role = 'owner'
  );
$$;

revoke all on function public.is_member(uuid), public.is_owner(uuid) from public, anon;
grant execute on function public.is_member(uuid), public.is_owner(uuid) to authenticated;

-- ───────── Registro: perfil + espacio personal automático ─────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_space uuid;
begin
  v_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'Yo')), 40);
  if v_name = '' then v_name := 'Yo'; end if;

  insert into public.profiles (id, display_name) values (new.id, v_name);
  insert into public.spaces (name, kind, created_by) values ('Personal', 'personal', new.id) returning id into v_space;
  insert into public.space_members (space_id, user_id, display_name, role, default_share_bp)
  values (v_space, new.id, v_name, 'owner', 10000);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Un espacio personal tiene exactamente 1 miembro y no admite invitaciones
create or replace function public.enforce_personal_single_member()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.spaces where id = new.space_id and kind = 'personal')
     and exists (select 1 from public.space_members where space_id = new.space_id) then
    raise exception 'Un espacio personal solo admite un miembro';
  end if;
  return new;
end;
$$;
create trigger personal_single_member
before insert on public.space_members
for each row execute function public.enforce_personal_single_member();

-- ───────── Auditoría: solo inserción ─────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  space_id uuid references public.spaces (id) on delete set null,
  actor uuid,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  diff jsonb,
  at timestamptz not null default now()
);
create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log es de solo inserción';
end;
$$;
create trigger audit_log_no_update before update or delete on public.audit_log
for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
for each statement execute function public.audit_log_immutable();

-- ───────── Rate limiting (ventana fija) ─────────
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Limpieza de contadores viejos (pg_cron o Vercel Cron)
create or replace function public.rate_limit_cleanup()
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
$$;
revoke all on function public.rate_limit_cleanup() from public, anon, authenticated;
grant execute on function public.rate_limit_cleanup() to service_role;

-- ───────── RLS: activado en TODAS las tablas ─────────
alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limits enable row level security;
-- Forzar RLS también al propietario de la tabla
alter table public.profiles force row level security;
alter table public.spaces force row level security;
alter table public.space_members force row level security;
alter table public.audit_log force row level security;
alter table public.rate_limits force row level security;

-- profiles: cada uno ve y edita solo el suyo
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- spaces: solo los miembros los ven; la creación va por RPC (fase 2); edición/borrado solo owner
create policy spaces_select_member on public.spaces for select to authenticated using (public.is_member(id));
create policy spaces_update_owner on public.spaces for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));
create policy spaces_delete_owner on public.spaces for delete to authenticated
  using (public.is_owner(id) and kind <> 'personal');

-- space_members: los miembros se ven entre sí; altas/bajas de otros las gestionan RPC (fase 2)
create policy members_select on public.space_members for select to authenticated using (public.is_member(space_id));
create policy members_update_self_or_owner on public.space_members for update to authenticated
  using (user_id = auth.uid() or public.is_owner(space_id))
  with check (user_id = auth.uid() or public.is_owner(space_id));

-- audit_log: lectura para miembros; nadie escribe directamente (lo hacen triggers security definer)
create policy audit_select_member on public.audit_log for select to authenticated
  using (space_id is not null and public.is_member(space_id));

-- rate_limits: sin políticas = ningún acceso para anon/authenticated (solo service_role vía RPC)

-- Privilegios mínimos: anon no toca nada; authenticated solo lo necesario
revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, update, delete on public.spaces to authenticated;
grant select, update on public.space_members to authenticated;
grant select on public.audit_log to authenticated;
-- El ajuste de columnas sensibles se hace por RPC; evitamos que se editen campos de confianza:
revoke update on public.space_members from authenticated;
grant update (display_name, default_share_bp) on public.space_members to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_color, locale, discreet_mode) on public.profiles to authenticated;
revoke update on public.spaces from authenticated;
grant update (name, emoji, starts_on, ends_on, archived_at, daily_budget_cents, template) on public.spaces to authenticated;
