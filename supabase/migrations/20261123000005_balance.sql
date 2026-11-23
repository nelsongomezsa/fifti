-- Fase 5: liquidaciones, compensación entre grupos (con doble confirmación) y resumen público.

create type public.settle_method as enum ('bizum', 'transfer', 'cash', 'offset', 'other');
create type public.offset_status as enum ('proposed', 'confirmed', 'rejected');

create table public.cross_offsets (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  status public.offset_status not null default 'proposed',
  confirmed_a boolean not null default false,
  confirmed_b boolean not null default false,
  created_at timestamptz not null default now(),
  check (user_a <> user_b)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  from_member uuid not null references public.space_members (id),
  to_member uuid not null references public.space_members (id),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  method public.settle_method not null default 'other',
  offset_id uuid references public.cross_offsets (id),
  note text check (note is null or char_length(note) <= 120),
  settled_at date not null default current_date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_member <> to_member)
);
create index settlements_space_idx on public.settlements (space_id, settled_at);

create table public.cross_offset_lines (
  id uuid primary key default gen_random_uuid(),
  offset_id uuid not null references public.cross_offsets (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  from_member uuid not null references public.space_members (id),
  to_member uuid not null references public.space_members (id),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000)
);

create trigger audit_settlements after insert or update or delete on public.settlements for each row execute function public.audit_row();

-- ───────── RPC ─────────
create or replace function public.record_settlement(
  p_space uuid, p_from uuid, p_to uuid, p_amount bigint, p_method public.settle_method, p_note text, p_date date)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me public.space_members; v_from public.space_members; v_to public.space_members; v_id uuid;
begin
  select * into v_me from public.space_members where space_id = p_space and user_id = auth.uid();
  if not found then raise exception 'No autorizado'; end if;
  if p_method = 'offset' then raise exception 'Las compensaciones se crean confirmándolas entre las dos personas'; end if;
  select * into v_from from public.space_members where id = p_from and space_id = p_space;
  select * into v_to from public.space_members where id = p_to and space_id = p_space;
  if v_from.id is null or v_to.id is null or v_from.id = v_to.id then raise exception 'Miembros no válidos'; end if;
  if v_me.id not in (v_from.id, v_to.id) and v_me.role <> 'owner' then raise exception 'Solo puede registrarlo quien paga, quien cobra o el propietario'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Importe no válido'; end if;
  insert into public.settlements (space_id, from_member, to_member, amount_cents, method, note, settled_at, created_by)
  values (p_space, p_from, p_to, p_amount, p_method, nullif(left(btrim(coalesce(p_note, '')), 120), ''), coalesce(p_date, current_date), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.delete_settlement(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.settlements;
begin
  select * into s from public.settlements where id = p_id;
  if not found then return; end if;
  if s.offset_id is not null then raise exception 'Una compensación no se puede borrar'; end if;
  if not (s.created_by = auth.uid() or public.is_owner(s.space_id)) then raise exception 'No autorizado'; end if;
  delete from public.settlements where id = p_id;
end; $$;

create or replace function public.propose_offset(p_other uuid, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare me uuid := auth.uid(); l record; v_id uuid; v_ab bigint := 0; v_ba bigint := 0; fu uuid; tu uuid; n integer;
begin
  if me is null or public.is_guest_user() or p_other is null or p_other = me then raise exception 'No autorizado'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 2 and 20 then raise exception 'La compensación necesita deudas en los dos sentidos'; end if;
  select count(*) into n from public.cross_offsets where status = 'proposed' and (user_a = me or user_b = me);
  if n >= 5 then raise exception 'Hay demasiadas propuestas pendientes'; end if;
  insert into public.cross_offsets (user_a, user_b, amount_cents, confirmed_a) values (me, p_other, 1, true) returning id into v_id;
  for l in select (e ->> 'space_id')::uuid sp, (e ->> 'from_member')::uuid fm, (e ->> 'to_member')::uuid tm, (e ->> 'amount_cents')::bigint amt
           from jsonb_array_elements(p_lines) e loop
    if l.amt is null or l.amt <= 0 or l.amt > 100000000000 then raise exception 'Importe no válido'; end if;
    -- las dos personas deben ser miembros con cuenta del mismo espacio, y quien propone también
    select user_id into fu from public.space_members where id = l.fm and space_id = l.sp;
    select user_id into tu from public.space_members where id = l.tm and space_id = l.sp;
    if fu is null or tu is null or fu = tu or not (fu in (me, p_other) and tu in (me, p_other)) then raise exception 'Línea no válida'; end if;
    if not exists (select 1 from public.space_members where space_id = l.sp and user_id = me) then raise exception 'No autorizado'; end if;
    insert into public.cross_offset_lines (offset_id, space_id, from_member, to_member, amount_cents) values (v_id, l.sp, l.fm, l.tm, l.amt);
    if fu = me then v_ab := v_ab + l.amt; else v_ba := v_ba + l.amt; end if;
  end loop;
  if v_ab = 0 or v_ab <> v_ba then raise exception 'Los importes de los dos sentidos deben coincidir'; end if;
  update public.cross_offsets set amount_cents = v_ab where id = v_id;
  return v_id;
end; $$;

create or replace function public.confirm_offset(p_id uuid)
returns public.offset_status language plpgsql security definer set search_path = public, pg_temp
as $$
declare o public.cross_offsets; l record;
begin
  select * into o from public.cross_offsets where id = p_id for update;
  if not found or auth.uid() not in (o.user_a, o.user_b) then raise exception 'No autorizado'; end if;
  if o.status <> 'proposed' then raise exception 'La propuesta ya no está pendiente'; end if;
  if auth.uid() = o.user_a then o.confirmed_a := true; else o.confirmed_b := true; end if;
  if o.confirmed_a and o.confirmed_b then
    for l in select * from public.cross_offset_lines where offset_id = o.id loop
      insert into public.settlements (space_id, from_member, to_member, amount_cents, method, offset_id, note, created_by)
      values (l.space_id, l.from_member, l.to_member, l.amount_cents, 'offset', o.id, 'Compensación entre grupos', auth.uid());
    end loop;
    o.status := 'confirmed';
  end if;
  update public.cross_offsets set confirmed_a = o.confirmed_a, confirmed_b = o.confirmed_b, status = o.status where id = o.id;
  return o.status;
end; $$;

create or replace function public.reject_offset(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.cross_offsets set status = 'rejected' where id = p_id and status = 'proposed' and auth.uid() in (user_a, user_b);
  if not found then raise exception 'No autorizado'; end if;
end; $$;

-- Datos del resumen público (solo service_role): totales por persona, sin conceptos ni detalles
create or replace function public.public_summary_data(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare l public.share_links; s public.spaces;
begin
  select * into l from public.share_links where token_hash = p_token_hash and kind = 'public_summary';
  if not found or l.revoked or l.expires_at < now() then return null; end if;
  select * into s from public.spaces where id = l.space_id;
  return jsonb_build_object(
    'space_name', s.name, 'emoji', s.emoji, 'currency', s.base_currency,
    'total_cents', coalesce((select sum(amount_base_cents) from public.expenses where space_id = s.id and paid_from = 'member'), 0),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.display_name,
        'paid', coalesce((select sum(p.amount_cents) from public.expense_payers p join public.expenses e on e.id = p.expense_id where p.member_id = m.id and e.space_id = s.id), 0),
        'owed', coalesce((select sum(sp.amount_cents) from public.expense_splits sp join public.expenses e on e.id = sp.expense_id where sp.member_id = m.id and e.space_id = s.id and e.paid_from = 'member'), 0),
        'sent', coalesce((select sum(amount_cents) from public.settlements where from_member = m.id), 0),
        'received', coalesce((select sum(amount_cents) from public.settlements where to_member = m.id), 0)
      ) order by m.joined_at) from public.space_members m where m.space_id = s.id), '[]'::jsonb));
end; $$;

do $$
declare f text;
begin
  foreach f in array array[
    'record_settlement(uuid, uuid, uuid, bigint, public.settle_method, text, date)', 'delete_settlement(uuid)',
    'propose_offset(uuid, jsonb)', 'confirm_offset(uuid)', 'reject_offset(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.public_summary_data(text) from public, anon, authenticated;
grant execute on function public.public_summary_data(text) to service_role;

-- ───────── RLS ─────────
alter table public.settlements enable row level security;
alter table public.settlements force row level security;
alter table public.cross_offsets enable row level security;
alter table public.cross_offsets force row level security;
alter table public.cross_offset_lines enable row level security;
alter table public.cross_offset_lines force row level security;
revoke all on public.settlements, public.cross_offsets, public.cross_offset_lines from anon, authenticated;
grant select on public.settlements, public.cross_offsets, public.cross_offset_lines to authenticated;

create policy settlements_select on public.settlements for select to authenticated using (public.is_member(space_id));
create policy offsets_select on public.cross_offsets for select to authenticated using (auth.uid() in (user_a, user_b));
create policy offset_lines_select on public.cross_offset_lines for select to authenticated
  using (exists (select 1 from public.cross_offsets o where o.id = offset_id and auth.uid() in (o.user_a, o.user_b)));
