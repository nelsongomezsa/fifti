-- Fase 3: fondos, categorías, etiquetas, ingresos, gastos (con reparto y gastos privados),
-- comentarios, reacciones, favoritos e historial de cambios.

-- Conservar el historial si una cuenta se borra: el miembro pasa a ser virtual
alter table public.space_members drop constraint space_members_user_id_fkey;
alter table public.space_members add constraint space_members_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

create or replace function public.is_full_member(p_space uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.space_members where space_id = p_space and user_id = auth.uid() and role in ('owner','member')); $$;
revoke all on function public.is_full_member(uuid) from public, anon;
grant execute on function public.is_full_member(uuid) to authenticated;

-- ───────── Fondos y categorías ─────────
create type public.fund_kind as enum ('fixed','variable','savings','leisure','investment','emergency','contribution','other');
create table public.funds (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind public.fund_kind not null default 'other',
  color text not null default '#9AA3AF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text check (icon is null or char_length(icon) <= 24),
  rollover boolean not null default false,
  linked_space_id uuid references public.spaces (id) on delete set null,
  position integer not null default 0,
  unique (id, space_id)
);
create index funds_space_idx on public.funds (space_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  fund_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  icon text check (icon is null or char_length(icon) <= 24),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  unique (id, space_id),
  foreign key (fund_id, space_id) references public.funds (id, space_id) on delete cascade
);
create index categories_space_idx on public.categories (space_id);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_áéíóúñü-]{1,30}$'),
  unique (space_id, name),
  unique (id, space_id)
);

-- ───────── Ingresos ─────────
create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  member_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  source text not null default 'Nómina' check (char_length(source) between 1 and 60),
  received_at date not null,
  is_recurring boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (member_id) references public.space_members (id)
);
create index incomes_space_idx on public.incomes (space_id, received_at);

-- ───────── Gastos ─────────
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  client_id uuid not null unique,
  description text not null check (char_length(description) between 1 and 120),
  category_id uuid,
  spent_at date not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  amount_base_cents bigint not null check (amount_base_cents > 0 and amount_base_cents <= 100000000000),
  paid_from text not null default 'member' check (paid_from in ('member', 'pot')),
  split_mode text not null default 'default' check (split_mode in ('default', 'equal', 'custom')),
  is_private boolean not null default false,
  recurring_id uuid,
  receipt_path text,
  created_by_member uuid not null references public.space_members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, space_id),
  foreign key (category_id, space_id) references public.categories (id, space_id) on delete set null (category_id)
);
create index expenses_space_date_idx on public.expenses (space_id, spent_at desc);

create table public.expense_payers (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  member_id uuid not null references public.space_members (id),
  amount_cents bigint not null check (amount_cents > 0),
  primary key (expense_id, member_id)
);
create table public.expense_splits (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  member_id uuid not null references public.space_members (id),
  share_bp integer not null check (share_bp between 0 and 10000),
  amount_cents bigint not null check (amount_cents >= 0),
  primary key (expense_id, member_id)
);
create index expense_splits_member_idx on public.expense_splits (member_id);

-- Detalle de un gasto privado: solo lo lee su autor
create table public.expense_private_details (
  expense_id uuid primary key references public.expenses (id) on delete cascade,
  author_user_id uuid not null references auth.users (id) on delete cascade,
  description text not null check (char_length(description) between 1 and 120),
  category_id uuid,
  receipt_path text
);

create table public.expense_tags (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (expense_id, tag_id)
);

create table public.expense_comments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null,
  space_id uuid not null,
  member_id uuid not null references public.space_members (id),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  foreign key (expense_id, space_id) references public.expenses (id, space_id) on delete cascade
);
create index expense_comments_expense_idx on public.expense_comments (expense_id);

create table public.expense_reactions (
  expense_id uuid not null,
  space_id uuid not null,
  member_id uuid not null references public.space_members (id),
  emoji text not null check (emoji in ('👍', '😂', '😮', '❤️', '🙏', '🔥')),
  primary key (expense_id, member_id, emoji),
  foreign key (expense_id, space_id) references public.expenses (id, space_id) on delete cascade
);

create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 30),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  category_id uuid references public.categories (id) on delete set null
);
create index favorites_user_idx on public.favorites (user_id);

-- ───────── Historial de cambios (solo inserción, escrito por triggers) ─────────
-- Sin FK a spaces: el SET NULL de la FK sería un UPDATE y el historial es inmutable.
alter table public.audit_log drop constraint audit_log_space_id_fkey;

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare r jsonb; v_space uuid; v_id uuid;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_space := (r ->> 'space_id')::uuid;
  v_id := (r ->> 'id')::uuid;
  insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
  values (v_space, auth.uid(), tg_table_name, v_id, lower(tg_op),
          case when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)) else r end);
  return null;
end; $$;
create trigger audit_expenses after insert or update or delete on public.expenses for each row execute function public.audit_row();
create trigger audit_incomes after insert or update or delete on public.incomes for each row execute function public.audit_row();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
create trigger expenses_touch before update on public.expenses for each row execute function public.touch_updated_at();

-- ───────── Fondos y categorías por defecto ─────────
create or replace function public.seed_space_defaults()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare f uuid;
begin
  if new.kind = 'group' then
    insert into public.funds (space_id, name, kind, color, position) values (new.id, 'General', 'variable', '#FF9F43', 0) returning id into f;
    insert into public.categories (space_id, fund_id, name)
      select new.id, f, n from unnest(case new.template
        when 'night' then array['Copas','Entradas','Taxi','Comida','Otros']
        when 'dinner' then array['Comida','Bebida','Postre','Propina','Otros']
        when 'trip' then array['Alojamiento','Transporte','Comida','Actividades','Compras','Otros']
        when 'flat' then array['Alquiler','Luz','Agua','Internet','Compra','Limpieza']
        else array['Comida','Bebida','Transporte','Alojamiento','Ocio','Otros'] end) n;
    return new;
  end if;

  insert into public.funds (space_id, name, kind, color, position) values (new.id, 'Gastos fijos', 'fixed', '#9AA3AF', 0) returning id into f;
  insert into public.categories (space_id, fund_id, name) select new.id, f, n from unnest(array['Alquiler','Luz','Agua','Internet','Suscripciones']) n;
  insert into public.funds (space_id, name, kind, color, position) values (new.id, 'Día a día', 'variable', '#7DD3FC', 1) returning id into f;
  insert into public.categories (space_id, fund_id, name) select new.id, f, n from unnest(array['Supermercado','Transporte','Salud','Casa']) n;
  insert into public.funds (space_id, name, kind, color, position) values (new.id, 'Ocio', 'leisure', '#FF9F43', 2) returning id into f;
  insert into public.categories (space_id, fund_id, name) select new.id, f, n from unnest(array['Salidas','Restaurantes','Compras','Viajes']) n;
  insert into public.funds (space_id, name, kind, color, position) values (new.id, 'Ahorro', 'savings', '#A78BFA', 3) returning id into f;
  insert into public.categories (space_id, fund_id, name) values (new.id, f, 'Ahorro');
  insert into public.funds (space_id, name, kind, color, position) values (new.id, 'Imprevistos', 'emergency', '#FF6B6B', 4) returning id into f;
  insert into public.categories (space_id, fund_id, name) values (new.id, f, 'Imprevistos');
  if new.kind = 'personal' then
    insert into public.funds (space_id, name, kind, color, position) values (new.id, 'Inversión', 'investment', '#C6F432', 5) returning id into f;
    insert into public.categories (space_id, fund_id, name) values (new.id, f, 'Inversión');
    insert into public.funds (space_id, name, kind, color, position) values (new.id, 'Aportación al hogar', 'contribution', '#C6F432', 6) returning id into f;
    insert into public.categories (space_id, fund_id, name) values (new.id, f, 'Aportación al hogar');
  end if;
  return new;
end; $$;
create trigger seed_space after insert on public.spaces for each row execute function public.seed_space_defaults();

-- ───────── RPC atómicas ─────────
create or replace function public.save_expense(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_space uuid := (p ->> 'space_id')::uuid;
  v_client uuid := (p ->> 'client_id')::uuid;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_me public.space_members;
  v_exp public.expenses;
  v_space_row public.spaces;
  v_amount bigint := (p ->> 'amount_cents')::bigint;
  v_base bigint := (p ->> 'amount_base_cents')::bigint;
  v_cur text := upper(p ->> 'currency');
  v_fx numeric := coalesce((p ->> 'fx_rate')::numeric, 1);
  v_paid text := coalesce(p ->> 'paid_from', 'member');
  v_private boolean := coalesce((p ->> 'is_private')::boolean, false);
  v_desc text := btrim(p ->> 'description');
  v_cat uuid := nullif(p ->> 'category_id', '')::uuid;
  v_sum_pay bigint; v_sum_split bigint; v_sum_bp integer; r record; t text; v_tag uuid;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  select * into v_space_row from public.spaces where id = v_space and archived_at is null;
  if not found then raise exception 'Espacio no disponible'; end if;
  select * into v_me from public.space_members where space_id = v_space and user_id = auth.uid();
  if not found then raise exception 'No autorizado'; end if;

  if v_desc is null or char_length(v_desc) not between 1 and 120 then raise exception 'Concepto no válido'; end if;
  if v_amount is null or v_amount <= 0 or v_amount > 100000000000 then raise exception 'Importe no válido'; end if;
  if v_base is null or v_base <= 0 or v_base > 100000000000 then raise exception 'Importe no válido'; end if;
  if v_cur = v_space_row.base_currency::text then
    if v_fx <> 1 or v_base <> v_amount then raise exception 'Cambio de moneda no válido'; end if;
  elsif abs(v_base - round(v_amount * v_fx)) > 1 then raise exception 'Cambio de moneda no válido';
  end if;
  if v_paid = 'pot' and (v_space_row.kind <> 'household' or v_me.role = 'guest') then raise exception 'Pago desde el bote no permitido'; end if;
  if v_private and v_space_row.kind = 'personal' then v_private := false; end if;
  if (p ->> 'spent_at') is null then raise exception 'Fecha no válida'; end if;

  -- Pagadores
  select coalesce(sum((e ->> 'amount_cents')::bigint), 0) into v_sum_pay from jsonb_array_elements(coalesce(p -> 'payers', '[]'::jsonb)) e;
  if v_paid = 'member' then
    if v_sum_pay <> v_base then raise exception 'Los pagos no suman el importe'; end if;
  elsif jsonb_array_length(coalesce(p -> 'payers', '[]'::jsonb)) > 0 then raise exception 'Un gasto del bote no tiene pagadores';
  end if;
  -- Reparto
  select coalesce(sum((e ->> 'amount_cents')::bigint), 0), coalesce(sum((e ->> 'share_bp')::integer), 0)
    into v_sum_split, v_sum_bp from jsonb_array_elements(coalesce(p -> 'splits', '[]'::jsonb)) e;
  if v_sum_split <> v_base then raise exception 'El reparto no suma el importe'; end if;
  if v_sum_bp <> 10000 then raise exception 'Los porcentajes deben sumar 100 %%'; end if;
  -- Miembros del mismo espacio
  for r in select (e ->> 'member_id')::uuid as mid from jsonb_array_elements(coalesce(p -> 'payers', '[]'::jsonb) || coalesce(p -> 'splits', '[]'::jsonb)) e loop
    if not exists (select 1 from public.space_members where id = r.mid and space_id = v_space) then raise exception 'Miembro ajeno al espacio'; end if;
  end loop;
  if v_cat is not null and not exists (select 1 from public.categories where id = v_cat and space_id = v_space) then
    raise exception 'Categoría ajena al espacio';
  end if;

  if v_id is not null then
    select * into v_exp from public.expenses where id = v_id and space_id = v_space for update;
    if not found then raise exception 'Gasto no encontrado'; end if;
    if v_me.role = 'guest' and v_exp.created_by_member <> v_me.id then raise exception 'No autorizado'; end if;
    update public.expenses set
      description = case when v_private then 'Gasto privado' else v_desc end,
      category_id = case when v_private then null else v_cat end,
      spent_at = (p ->> 'spent_at')::date, amount_cents = v_amount, currency = v_cur, fx_rate = v_fx, amount_base_cents = v_base,
      paid_from = v_paid, split_mode = coalesce(p ->> 'split_mode', 'default'), is_private = v_private
    where id = v_id;
    delete from public.expense_payers where expense_id = v_id;
    delete from public.expense_splits where expense_id = v_id;
    delete from public.expense_tags where expense_id = v_id;
    delete from public.expense_private_details where expense_id = v_id;
  else
    select id into v_id from public.expenses where client_id = v_client;
    if v_id is not null then
      -- Reintento idempotente (cola offline): solo si es del mismo espacio
      if not exists (select 1 from public.expenses where id = v_id and space_id = v_space and created_by_member = v_me.id) then
        raise exception 'No autorizado';
      end if;
      return v_id;
    end if;
    insert into public.expenses (space_id, client_id, description, category_id, spent_at, amount_cents, currency, fx_rate,
      amount_base_cents, paid_from, split_mode, is_private, created_by_member)
    values (v_space, v_client, case when v_private then 'Gasto privado' else v_desc end, case when v_private then null else v_cat end,
      (p ->> 'spent_at')::date, v_amount, v_cur, v_fx, v_base, v_paid, coalesce(p ->> 'split_mode', 'default'), v_private, v_me.id)
    returning id into v_id;
  end if;

  insert into public.expense_payers (expense_id, member_id, amount_cents)
    select v_id, (e ->> 'member_id')::uuid, (e ->> 'amount_cents')::bigint from jsonb_array_elements(coalesce(p -> 'payers', '[]'::jsonb)) e;
  insert into public.expense_splits (expense_id, member_id, share_bp, amount_cents)
    select v_id, (e ->> 'member_id')::uuid, (e ->> 'share_bp')::integer, (e ->> 'amount_cents')::bigint from jsonb_array_elements(p -> 'splits') e;
  if v_private then
    insert into public.expense_private_details (expense_id, author_user_id, description, category_id)
    values (v_id, auth.uid(), v_desc, v_cat);
  end if;
  for t in select lower(btrim(x)) from jsonb_array_elements_text(case when v_private then '[]'::jsonb else coalesce(p -> 'tags', '[]'::jsonb) end) x loop
    if t !~ '^[a-z0-9_áéíóúñü-]{1,30}$' then raise exception 'Etiqueta no válida'; end if;
    insert into public.tags (space_id, name) values (v_space, t) on conflict (space_id, name) do update set name = excluded.name returning id into v_tag;
    insert into public.expense_tags (expense_id, tag_id) values (v_id, v_tag) on conflict do nothing;
  end loop;
  return v_id;
end; $$;

create or replace function public.delete_expense(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare e public.expenses; me public.space_members;
begin
  select * into e from public.expenses where id = p_id;
  if not found then return; end if;
  select * into me from public.space_members where space_id = e.space_id and user_id = auth.uid();
  if not found then raise exception 'No autorizado'; end if;
  if me.role = 'guest' and e.created_by_member <> me.id then raise exception 'No autorizado'; end if;
  delete from public.expenses where id = p_id;
end; $$;

create or replace function public.save_income(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_space uuid := (p ->> 'space_id')::uuid; v_member uuid := (p ->> 'member_id')::uuid; v_id uuid; m public.space_members;
begin
  if not public.is_full_member(v_space) then raise exception 'No autorizado'; end if;
  select * into m from public.space_members where id = v_member and space_id = v_space;
  if not found then raise exception 'Miembro ajeno al espacio'; end if;
  if not (m.user_id = auth.uid() or (m.user_id is null and public.is_owner(v_space))) then raise exception 'No autorizado'; end if;
  insert into public.incomes (space_id, member_id, amount_cents, currency, source, received_at, is_recurring)
  values (v_space, v_member, (p ->> 'amount_cents')::bigint, (select base_currency from public.spaces where id = v_space),
          left(btrim(coalesce(p ->> 'source', 'Nómina')), 60), (p ->> 'received_at')::date, coalesce((p ->> 'is_recurring')::boolean, false))
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.delete_income(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.incomes; m public.space_members;
begin
  select * into i from public.incomes where id = p_id;
  if not found then return; end if;
  select * into m from public.space_members where id = i.member_id;
  if not (m.user_id = auth.uid() or (m.user_id is null and public.is_owner(i.space_id))) then raise exception 'No autorizado'; end if;
  delete from public.incomes where id = p_id;
end; $$;

do $$
declare f text;
begin
  foreach f in array array['save_expense(jsonb)', 'delete_expense(uuid)', 'save_income(jsonb)', 'delete_income(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────── RLS ─────────
do $$
declare t text;
begin
  foreach t in array array['funds','categories','tags','incomes','expenses','expense_payers','expense_splits','expense_private_details',
                           'expense_tags','expense_comments','expense_reactions','favorites'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Lectura por pertenencia al espacio
create policy funds_select on public.funds for select to authenticated using (public.is_member(space_id));
create policy categories_select on public.categories for select to authenticated using (public.is_member(space_id));
create policy tags_select on public.tags for select to authenticated using (public.is_member(space_id));
create policy incomes_select on public.incomes for select to authenticated using (public.is_member(space_id));
create policy expenses_select on public.expenses for select to authenticated using (public.is_member(space_id));
create policy payers_select on public.expense_payers for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.space_id)));
create policy splits_select on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.space_id)));
create policy expense_tags_select on public.expense_tags for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.space_id)));
create policy private_details_select on public.expense_private_details for select to authenticated using (author_user_id = auth.uid());
create policy comments_select on public.expense_comments for select to authenticated using (public.is_member(space_id));
create policy reactions_select on public.expense_reactions for select to authenticated using (public.is_member(space_id));
create policy favorites_all on public.favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(space_id));

grant select on public.funds, public.categories, public.tags, public.incomes, public.expenses, public.expense_payers,
  public.expense_splits, public.expense_tags, public.expense_private_details, public.expense_comments, public.expense_reactions to authenticated;
-- No exponer el recibo privado ni el detalle: solo columnas del autor vía policy (ya filtrado). Ocultar receipt_path de gastos privados no aplica aquí.
grant select, insert, update, delete on public.favorites to authenticated;

-- Escritura directa: fondos/categorías (miembros completos), etiquetas, comentarios y reacciones
create policy funds_write on public.funds for all to authenticated
  using (public.is_full_member(space_id)) with check (public.is_full_member(space_id));
create policy categories_write on public.categories for all to authenticated
  using (public.is_full_member(space_id)) with check (public.is_full_member(space_id));
grant insert, update, delete on public.funds, public.categories to authenticated;

create policy comments_insert on public.expense_comments for insert to authenticated
  with check (public.is_member(space_id) and exists (select 1 from public.space_members m where m.id = member_id and m.user_id = auth.uid() and m.space_id = expense_comments.space_id));
create policy comments_delete on public.expense_comments for delete to authenticated
  using (exists (select 1 from public.space_members m where m.id = member_id and m.user_id = auth.uid()));
create policy reactions_insert on public.expense_reactions for insert to authenticated
  with check (public.is_member(space_id) and exists (select 1 from public.space_members m where m.id = member_id and m.user_id = auth.uid() and m.space_id = expense_reactions.space_id));
create policy reactions_delete on public.expense_reactions for delete to authenticated
  using (exists (select 1 from public.space_members m where m.id = member_id and m.user_id = auth.uid()));
grant insert, delete on public.expense_comments, public.expense_reactions to authenticated;
