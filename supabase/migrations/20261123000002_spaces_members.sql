-- Fase 2: burbujas fijas y espontáneas, invitaciones, invitados sin cuenta y reclamar perfil.

alter table public.spaces add column shares_custom boolean not null default false;

-- Invitados = usuarios anónimos de Supabase Auth (sesión en cookie httpOnly firmada por Auth).
create or replace function public.is_guest_user()
returns boolean language sql stable
set search_path = public, pg_temp
as $$ select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false); $$;

-- No crear perfil ni espacio personal para invitados anónimos
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_name text; v_space uuid;
begin
  if coalesce(new.is_anonymous, false) then return new; end if;
  v_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'Yo')), 40);
  if v_name = '' then v_name := 'Yo'; end if;
  insert into public.profiles (id, display_name) values (new.id, v_name) on conflict do nothing;
  if not exists (select 1 from public.spaces where created_by = new.id and kind = 'personal') then
    insert into public.spaces (name, kind, created_by) values ('Personal', 'personal', new.id) returning id into v_space;
    insert into public.space_members (space_id, user_id, display_name, role, default_share_bp)
    values (v_space, new.id, v_name, 'owner', 10000);
  end if;
  return new;
end; $$;

-- Un invitado que se crea cuenta (anónimo -> permanente) conserva su historial y recibe su perfil/espacio personal
create or replace function public.handle_user_upgrade()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_name text; v_space uuid;
begin
  if coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false) then
    v_name := left(btrim(coalesce(
      (select display_name from public.space_members where user_id = new.id order by joined_at limit 1),
      split_part(new.email, '@', 1), 'Yo')), 40);
    if v_name = '' then v_name := 'Yo'; end if;
    insert into public.profiles (id, display_name) values (new.id, v_name) on conflict do nothing;
    if not exists (select 1 from public.spaces where created_by = new.id and kind = 'personal') then
      insert into public.spaces (name, kind, created_by) values ('Personal', 'personal', new.id) returning id into v_space;
      insert into public.space_members (space_id, user_id, display_name, role, default_share_bp)
      values (v_space, new.id, v_name, 'owner', 10000);
    end if;
  end if;
  return new;
end; $$;
create trigger on_auth_user_upgraded after update of is_anonymous on auth.users
for each row execute function public.handle_user_upgrade();

-- Un invitado solo puede estar en un grupo
create or replace function public.enforce_guest_single_space()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.user_id is not null and exists (
       select 1 from auth.users u where u.id = new.user_id and coalesce(u.is_anonymous, false))
     and exists (select 1 from public.space_members m where m.user_id = new.user_id and m.id <> new.id) then
    raise exception 'Un invitado solo puede pertenecer a un grupo';
  end if;
  return new;
end; $$;
create trigger guest_single_space before insert or update of user_id on public.space_members
for each row execute function public.enforce_guest_single_space();

-- ───────── Enlaces (invitación, invitado, resumen público) ─────────
create type public.share_kind as enum ('invite', 'guest', 'public_summary');
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  kind public.share_kind not null,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses between 1 and 1000),
  uses integer not null default 0 check (uses >= 0),
  revoked boolean not null default false,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index share_links_space_idx on public.share_links (space_id);
alter table public.share_links enable row level security;
alter table public.share_links force row level security;
create policy share_links_select_owner on public.share_links for select to authenticated using (public.is_owner(space_id));
revoke all on public.share_links from anon, authenticated;
grant select (id, space_id, kind, expires_at, max_uses, uses, revoked, created_by, created_at) on public.share_links to authenticated;

-- Ocultar hashes de reclamación a los clientes
revoke select on public.space_members from authenticated;
grant select (id, space_id, user_id, display_name, role, default_share_bp, claim_expires_at, joined_at) on public.space_members to authenticated;

-- ───────── Reparto por defecto ─────────
create or replace function public._rebalance_shares(p_space uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare n integer; base integer; rem integer; r record; i integer := 0;
begin
  if (select shares_custom from public.spaces where id = p_space) then return; end if;
  select count(*) into n from public.space_members where space_id = p_space;
  if n = 0 then return; end if;
  base := 10000 / n; rem := 10000 - base * n;
  for r in select id from public.space_members where space_id = p_space order by joined_at, id loop
    update public.space_members set default_share_bp = base + case when i < rem then 1 else 0 end where id = r.id;
    i := i + 1;
  end loop;
end; $$;
revoke all on function public._rebalance_shares(uuid) from public, anon, authenticated;

-- ───────── RPC ─────────
create or replace function public.create_space(
  p_name text, p_kind public.space_kind, p_currency text default 'EUR', p_emoji text default null,
  p_template text default null, p_starts date default null, p_ends date default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_name text;
begin
  if auth.uid() is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  if p_kind = 'personal' then raise exception 'El espacio personal se crea solo'; end if;
  if (select count(*) from public.spaces where created_by = auth.uid() and kind <> 'personal') >= 50 then
    raise exception 'Límite de burbujas alcanzado';
  end if;
  select display_name into v_name from public.profiles where id = auth.uid();
  insert into public.spaces (name, kind, base_currency, emoji, template, starts_on, ends_on, created_by)
  values (btrim(p_name), p_kind, upper(p_currency), p_emoji, p_template, p_starts, p_ends, auth.uid())
  returning id into v_id;
  insert into public.space_members (space_id, user_id, display_name, role, default_share_bp)
  values (v_id, auth.uid(), coalesce(v_name, 'Yo'), 'owner', 10000);
  return v_id;
end; $$;

create or replace function public.add_virtual_member(p_space uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.is_owner(p_space) then raise exception 'No autorizado'; end if;
  if (select kind from public.spaces where id = p_space) = 'personal' then raise exception 'Un espacio personal no admite miembros'; end if;
  if (select count(*) from public.space_members where space_id = p_space) >= 50 then raise exception 'Límite de miembros'; end if;
  insert into public.space_members (space_id, display_name, role) values (p_space, left(btrim(p_name), 40), 'member') returning id into v_id;
  perform public._rebalance_shares(p_space);
  return v_id;
end; $$;

create or replace function public.set_default_shares(p_space uuid, p_shares jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare total integer := 0; n integer; r record;
begin
  if not public.is_owner(p_space) then raise exception 'No autorizado'; end if;
  select count(*) into n from public.space_members where space_id = p_space;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) <> n then raise exception 'Faltan miembros en el reparto'; end if;
  for r in select (e ->> 'member_id')::uuid as mid, (e ->> 'bp')::integer as bp from jsonb_array_elements(p_shares) e loop
    if r.bp < 0 or r.bp > 10000 then raise exception 'Porcentaje fuera de rango'; end if;
    if not exists (select 1 from public.space_members where id = r.mid and space_id = p_space) then raise exception 'Miembro ajeno al espacio'; end if;
    total := total + r.bp;
  end loop;
  if total <> 10000 then raise exception 'Los porcentajes deben sumar 100 %%'; end if;
  for r in select (e ->> 'member_id')::uuid as mid, (e ->> 'bp')::integer as bp from jsonb_array_elements(p_shares) e loop
    update public.space_members set default_share_bp = r.bp where id = r.mid;
  end loop;
  update public.spaces set shares_custom = true where id = p_space;
end; $$;

create or replace function public.create_share_link(
  p_space uuid, p_kind public.share_kind, p_token_hash text, p_ttl_seconds integer, p_max_uses integer)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_kind public.space_kind;
begin
  if not public.is_owner(p_space) then raise exception 'No autorizado'; end if;
  select kind into v_kind from public.spaces where id = p_space;
  if v_kind = 'personal' then raise exception 'Un espacio personal no admite enlaces'; end if;
  if p_kind = 'guest' and v_kind <> 'group' then raise exception 'Los invitados solo entran en grupos'; end if;
  if p_ttl_seconds < 60 or p_ttl_seconds > 60 * 60 * 24 * 90 then raise exception 'Caducidad no válida'; end if;
  insert into public.share_links (space_id, kind, token_hash, expires_at, max_uses, created_by)
  values (p_space, p_kind, p_token_hash, now() + make_interval(secs => p_ttl_seconds), p_max_uses, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.revoke_share_link(p_link uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.share_links set revoked = true where id = p_link and public.is_owner(space_id);
  if not found then raise exception 'No autorizado'; end if;
end; $$;

-- Consulta pública del enlace (solo service_role): nombre del grupo y perfiles virtuales libres
create or replace function public.lookup_share_link(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare l public.share_links; s public.spaces;
begin
  select * into l from public.share_links where token_hash = p_token_hash;
  if not found or l.revoked or l.expires_at < now() or l.uses >= l.max_uses then return null; end if;
  select * into s from public.spaces where id = l.space_id and archived_at is null;
  if not found then return null; end if;
  return jsonb_build_object(
    'kind', l.kind, 'space_name', s.name, 'emoji', s.emoji, 'space_kind', s.kind,
    'free_members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.display_name) order by m.joined_at)
                              from public.space_members m where m.space_id = s.id and m.user_id is null), '[]'::jsonb));
end; $$;

create or replace function public.accept_invite(p_token_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare l public.share_links; v_name text;
begin
  if auth.uid() is null or public.is_guest_user() then raise exception 'Necesitas una cuenta'; end if;
  select * into l from public.share_links where token_hash = p_token_hash for update;
  if not found or l.kind <> 'invite' or l.revoked or l.expires_at < now() or l.uses >= l.max_uses then
    raise exception 'Enlace no válido';
  end if;
  if exists (select 1 from public.space_members where space_id = l.space_id and user_id = auth.uid()) then return l.space_id; end if;
  select display_name into v_name from public.profiles where id = auth.uid();
  insert into public.space_members (space_id, user_id, display_name, role)
  values (l.space_id, auth.uid(), coalesce(v_name, 'Yo'), 'member');
  update public.share_links set uses = uses + 1 where id = l.id;
  perform public._rebalance_shares(l.space_id);
  return l.space_id;
end; $$;

-- Invitado: entra como perfil virtual existente o crea uno nuevo. Solo un grupo, solo un perfil.
create or replace function public.join_as_guest(p_token_hash text, p_member uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare l public.share_links; v_id uuid;
begin
  if auth.uid() is null or not public.is_guest_user() then raise exception 'Sesión de invitado necesaria'; end if;
  select * into l from public.share_links where token_hash = p_token_hash for update;
  if not found or l.kind <> 'guest' or l.revoked or l.expires_at < now() or l.uses >= l.max_uses then
    raise exception 'Enlace no válido';
  end if;
  if (select kind from public.spaces where id = l.space_id) <> 'group' then raise exception 'Enlace no válido'; end if;
  if exists (select 1 from public.space_members where user_id = auth.uid()) then
    raise exception 'Esta sesión ya pertenece a un grupo';
  end if;
  if p_member is not null then
    update public.space_members set user_id = auth.uid(), role = 'guest'
    where id = p_member and space_id = l.space_id and user_id is null returning id into v_id;
    if v_id is null then raise exception 'Ese perfil ya no está libre'; end if;
  else
    if (select count(*) from public.space_members where space_id = l.space_id) >= 50 then raise exception 'Grupo lleno'; end if;
    insert into public.space_members (space_id, user_id, display_name, role)
    values (l.space_id, auth.uid(), left(btrim(p_name), 40), 'guest') returning id into v_id;
  end if;
  update public.share_links set uses = uses + 1 where id = l.id;
  perform public._rebalance_shares(l.space_id);
  return v_id;
end; $$;

-- Expulsar: el miembro vuelve a ser virtual (se conserva su historial)
create or replace function public.kick_member(p_member uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare m public.space_members;
begin
  select * into m from public.space_members where id = p_member;
  if not found or not public.is_owner(m.space_id) then raise exception 'No autorizado'; end if;
  if m.role = 'owner' then raise exception 'No se puede expulsar al propietario'; end if;
  update public.space_members set user_id = null, claim_token_hash = null, claim_expires_at = null where id = p_member;
end; $$;

-- Reclamar perfil virtual con enlace de un solo uso, caducable
create or replace function public.create_claim_link(p_member uuid, p_token_hash text, p_ttl_seconds integer)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare m public.space_members;
begin
  select * into m from public.space_members where id = p_member;
  if not found or not public.is_owner(m.space_id) or m.user_id is not null then raise exception 'No autorizado'; end if;
  if p_ttl_seconds < 60 or p_ttl_seconds > 60 * 60 * 24 * 30 then raise exception 'Caducidad no válida'; end if;
  update public.space_members set claim_token_hash = p_token_hash, claim_expires_at = now() + make_interval(secs => p_ttl_seconds)
  where id = p_member;
end; $$;

create or replace function public.claim_member(p_token_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare m public.space_members;
begin
  if auth.uid() is null or public.is_guest_user() then raise exception 'Necesitas una cuenta'; end if;
  select * into m from public.space_members where claim_token_hash = p_token_hash for update;
  if not found or m.user_id is not null or m.claim_expires_at is null or m.claim_expires_at < now() then
    raise exception 'Enlace no válido';
  end if;
  if exists (select 1 from public.space_members where space_id = m.space_id and user_id = auth.uid()) then
    raise exception 'Ya eres miembro de este espacio';
  end if;
  update public.space_members set user_id = auth.uid(), claim_token_hash = null, claim_expires_at = null where id = m.id;
  return m.space_id;
end; $$;

-- Permisos de ejecución
do $$
declare f text;
begin
  foreach f in array array[
    'create_space(text, public.space_kind, text, text, text, date, date)',
    'add_virtual_member(uuid, text)', 'set_default_shares(uuid, jsonb)',
    'create_share_link(uuid, public.share_kind, text, integer, integer)', 'revoke_share_link(uuid)',
    'accept_invite(text)', 'join_as_guest(text, uuid, text)', 'kick_member(uuid)',
    'create_claim_link(uuid, text, integer)', 'claim_member(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.lookup_share_link(text) from public, anon, authenticated;
grant execute on function public.lookup_share_link(text) to service_role;
revoke all on function public.is_guest_user() from public, anon;
grant execute on function public.is_guest_user() to authenticated;
