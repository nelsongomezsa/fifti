-- Cuentas bancarias (solo etiquetas y saldos calculados): Fifti no se conecta a bancos ni guarda IBAN ni credenciales.
-- Una cuenta guarda nombre, banco (texto), color, tipo y saldo inicial con fecha.

create type public.account_kind as enum ('payroll', 'daily', 'savings', 'shared');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  bank text check (bank is null or char_length(bank) <= 60),
  color text not null default '#9AA3AF' check (color ~ '^#[0-9a-fA-F]{6}$'),
  kind public.account_kind not null default 'daily',
  opening_cents bigint not null default 0 check (opening_cents between -100000000000 and 100000000000),
  opening_date date not null default current_date,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index accounts_owner_idx on public.accounts (owner_user_id);
create index accounts_space_idx on public.accounts (space_id);

create table public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_account uuid not null references public.accounts (id) on delete cascade,
  to_account uuid not null references public.accounts (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  transfer_date date not null default current_date,
  note text check (note is null or char_length(note) <= 80),
  source text not null default 'manual' check (source in ('manual', 'household_contribution', 'payroll_split')),
  created_at timestamptz not null default now(),
  check (from_account <> to_account)
);
create index account_transfers_from_idx on public.account_transfers (from_account, transfer_date);
create index account_transfers_to_idx on public.account_transfers (to_account, transfer_date);

create table public.account_adjustments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  amount_cents bigint not null check (amount_cents <> 0 and amount_cents between -100000000000 and 100000000000),
  adjust_date date not null default current_date,
  note text check (note is null or char_length(note) <= 80),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index account_adjustments_idx on public.account_adjustments (account_id, adjust_date);

alter table public.expenses add column account_id uuid references public.accounts (id) on delete set null;
alter table public.incomes add column account_id uuid references public.accounts (id) on delete set null;
alter table public.recurring_expenses add column account_id uuid references public.accounts (id) on delete set null;
alter table public.funds add column account_id uuid references public.accounts (id) on delete set null;
alter table public.notification_prefs add column payday_split boolean not null default true;

-- ───────── Visibilidad: cada persona ve sus cuentas y las comunes de sus espacios ─────────
create or replace function public.can_see_account(p_account uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.accounts a where a.id = p_account
                     and (a.owner_user_id = auth.uid() or (a.kind = 'shared' and public.is_member(a.space_id)))); $$;
revoke all on function public.can_see_account(uuid) from public, anon;
grant execute on function public.can_see_account(uuid) to authenticated;

alter table public.accounts enable row level security; alter table public.accounts force row level security;
alter table public.account_transfers enable row level security; alter table public.account_transfers force row level security;
alter table public.account_adjustments enable row level security; alter table public.account_adjustments force row level security;
create policy accounts_select on public.accounts for select to authenticated
  using (owner_user_id = auth.uid() or (kind = 'shared' and public.is_member(space_id)));
create policy transfers_select on public.account_transfers for select to authenticated
  using (public.can_see_account(from_account) or public.can_see_account(to_account));
create policy adjustments_select on public.account_adjustments for select to authenticated using (public.can_see_account(account_id));
revoke all on public.accounts, public.account_transfers, public.account_adjustments from anon, authenticated;
grant select on public.accounts, public.account_transfers, public.account_adjustments to authenticated;
-- Todo lo que escribe va por funciones que validan pertenencia e importes.

-- ───────── Cuenta por defecto en los movimientos nuevos ─────────
create or replace function public.assign_default_account()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.account_id is null and auth.uid() is not null and coalesce(current_setting('fifti.no_default_account', true), '') <> '1' then
    select a.id into new.account_id from public.accounts a
      where a.owner_user_id = auth.uid() and a.space_id = new.space_id and a.is_default and a.archived_at is null limit 1;
  end if;
  return new;
end; $$;
create trigger expenses_default_account before insert on public.expenses for each row execute function public.assign_default_account();
create trigger incomes_default_account before insert on public.incomes for each row execute function public.assign_default_account();
create trigger recurring_default_account before insert on public.recurring_expenses for each row execute function public.assign_default_account();

-- Las aportaciones al hogar no llevan cuenta propia: su dinero se mueve con el traspaso a la cuenta común (así no se cuenta dos veces)
create or replace function public.contribute_household(p_space uuid, p_amount bigint)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); sp public.spaces; me public.space_members; c public.contributions; v_month date := date_trunc('month', current_date)::date;
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Importe no válido'; end if;
  select * into sp from public.spaces where id = p_space;
  if not found or sp.kind <> 'household' or sp.archived_at is not null then raise exception 'No autorizado'; end if;
  select * into me from public.space_members where space_id = p_space and user_id = uid;
  if not found then raise exception 'No autorizado'; end if;
  insert into public.contributions (space_id, member_id, month, expected_cents)
  values (p_space, me.id, v_month, 0) on conflict (space_id, member_id, month) do nothing;
  select * into c from public.contributions where space_id = p_space and member_id = me.id and month = v_month for update;
  if c.paid_cents + p_amount > 100000000000 then raise exception 'Importe no válido'; end if;
  perform set_config('fifti.no_default_account', '1', true);
  perform public.mark_contribution_paid(c.id, c.paid_cents + p_amount);
  perform set_config('fifti.no_default_account', '', true);
  return c.id;
end; $$;

-- ───────── Saldo ─────────
-- saldo inicial + ingresos − gastos + traspasos recibidos − traspasos enviados + ajustes, desde la fecha del saldo inicial
create or replace function public._account_balance(p_account uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp
as $$
  select a.opening_cents
    + coalesce((select sum(i.amount_cents) from public.incomes i where i.account_id = a.id and i.received_at >= a.opening_date), 0)
    - coalesce((select sum(e.amount_base_cents) from public.expenses e where e.account_id = a.id and e.spent_at >= a.opening_date), 0)
    + coalesce((select sum(t.amount_cents) from public.account_transfers t where t.to_account = a.id and t.transfer_date >= a.opening_date), 0)
    - coalesce((select sum(t.amount_cents) from public.account_transfers t where t.from_account = a.id and t.transfer_date >= a.opening_date), 0)
    + coalesce((select sum(j.amount_cents) from public.account_adjustments j where j.account_id = a.id and j.adjust_date >= a.opening_date), 0)
  from public.accounts a where a.id = p_account;
$$;
revoke all on function public._account_balance(uuid) from public, anon, authenticated;

create or replace function public.account_balances()
returns table (account_id uuid, balance_cents bigint) language sql stable security definer set search_path = public, pg_temp
as $$ select a.id, public._account_balance(a.id) from public.accounts a
      where a.owner_user_id = auth.uid() or (a.kind = 'shared' and public.is_member(a.space_id)); $$;
revoke all on function public.account_balances() from public, anon;
grant execute on function public.account_balances() to authenticated;

-- ───────── Crear, editar y archivar cuentas ─────────
create or replace function public.save_account(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); v_id uuid := nullif(p ->> 'id', '')::uuid; v_space uuid := (p ->> 'space_id')::uuid; sp public.spaces;
        v_kind public.account_kind := coalesce(nullif(p ->> 'kind', ''), 'daily')::public.account_kind; a public.accounts; v_default boolean := coalesce((p ->> 'is_default')::boolean, false);
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  if v_id is not null then
    select * into a from public.accounts where id = v_id;
    if not found or a.owner_user_id <> uid then raise exception 'No autorizado'; end if;
    v_space := a.space_id;
  end if;
  select * into sp from public.spaces where id = v_space;
  if not found or not public.is_member(v_space) or sp.archived_at is not null then raise exception 'No autorizado'; end if;
  if v_kind = 'shared' and sp.kind = 'personal' then raise exception 'Una cuenta común va en un hogar o un grupo'; end if;
  if v_id is null then
    if (select count(*) from public.accounts where owner_user_id = uid and archived_at is null) >= 20 then raise exception 'Demasiadas cuentas'; end if;
    if not exists (select 1 from public.accounts where owner_user_id = uid and space_id = v_space and archived_at is null) then v_default := true; end if;
    insert into public.accounts (space_id, owner_user_id, name, bank, color, kind, opening_cents, opening_date, is_default)
    values (v_space, uid, left(trim(p ->> 'name'), 60), nullif(left(trim(coalesce(p ->> 'bank', '')), 60), ''), coalesce(nullif(p ->> 'color', ''), '#9AA3AF'), v_kind,
            coalesce((p ->> 'opening_cents')::bigint, 0), coalesce(nullif(p ->> 'opening_date', '')::date, current_date), v_default)
    returning id into v_id;
  else
    update public.accounts set name = left(trim(p ->> 'name'), 60), bank = nullif(left(trim(coalesce(p ->> 'bank', '')), 60), ''),
      color = coalesce(nullif(p ->> 'color', ''), color), kind = v_kind, opening_cents = coalesce((p ->> 'opening_cents')::bigint, opening_cents),
      opening_date = coalesce(nullif(p ->> 'opening_date', '')::date, opening_date) where id = v_id;
  end if;
  if v_default then
    update public.accounts set is_default = (id = v_id) where owner_user_id = uid and space_id = v_space;
  end if;
  return v_id;
end; $$;

create or replace function public.archive_account(p_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.accounts where id = p_id and owner_user_id = auth.uid()) then raise exception 'No autorizado'; end if;
  update public.accounts set archived_at = case when p_archived then now() else null end, is_default = case when p_archived then false else is_default end where id = p_id;
end; $$;

-- Cuenta de un movimiento ya guardado (gasto, ingreso o gasto fijo): solo su autor y solo con cuentas que la persona ve en ese espacio
create or replace function public.set_movement_account(p_kind text, p_id uuid, p_account uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); v_space uuid; a public.accounts;
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  if p_account is not null then
    select * into a from public.accounts where id = p_account and archived_at is null;
    if not found or not public.can_see_account(p_account) then raise exception 'No autorizado'; end if;
  end if;
  if p_kind = 'expense' then
    select e.space_id into v_space from public.expenses e join public.space_members m on m.id = e.created_by_member where e.id = p_id and m.user_id = uid;
  elsif p_kind = 'income' then
    select i.space_id into v_space from public.incomes i join public.space_members m on m.id = i.member_id where i.id = p_id and m.user_id = uid;
  elsif p_kind = 'recurring' then
    select r.space_id into v_space from public.recurring_expenses r where r.id = p_id and public.is_member(r.space_id);
  else raise exception 'Datos no válidos'; end if;
  if v_space is null then raise exception 'No autorizado'; end if;
  if p_account is not null and a.space_id <> v_space then raise exception 'Esa cuenta es de otro espacio'; end if;
  if p_kind = 'expense' then update public.expenses set account_id = p_account where id = p_id;
  elsif p_kind = 'income' then update public.incomes set account_id = p_account where id = p_id;
  else update public.recurring_expenses set account_id = p_account where id = p_id; end if;
end; $$;

create or replace function public.set_fund_account(p_fund uuid, p_account uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_space uuid;
begin
  select space_id into v_space from public.funds where id = p_fund;
  if v_space is null or not public.is_owner(v_space) then raise exception 'No autorizado'; end if;
  if p_account is not null and not exists (select 1 from public.accounts a where a.id = p_account and a.owner_user_id = auth.uid()) then raise exception 'No autorizado'; end if;
  update public.funds set account_id = p_account where id = p_fund;
end; $$;

-- ───────── Traspasos y ajustes ─────────
-- Un traspaso no es gasto ni ingreso: solo mueve saldo. Si el destino es la cuenta común de un hogar, se registra además
-- como aportación al hogar (una sola vez: la aportación no lleva cuenta propia).
create or replace function public.create_transfer(p_from uuid, p_to uuid, p_amount bigint, p_date date, p_note text, p_source text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); f public.accounts; t public.accounts; v_id uuid; v_source text := coalesce(p_source, 'manual'); sp public.spaces;
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Importe no válido'; end if;
  if p_from = p_to then raise exception 'Elige dos cuentas distintas'; end if;
  if v_source not in ('manual', 'payroll_split', 'household_contribution') then raise exception 'Datos no válidos'; end if;
  select * into f from public.accounts where id = p_from and archived_at is null;
  select * into t from public.accounts where id = p_to and archived_at is null;
  if f.id is null or t.id is null or not public.can_see_account(p_from) or not public.can_see_account(p_to) then raise exception 'No autorizado'; end if;
  if f.owner_user_id <> uid then raise exception 'Solo puedes sacar dinero de tus cuentas'; end if;
  select * into sp from public.spaces where id = t.space_id;
  if t.kind = 'shared' and sp.kind = 'household' and f.owner_user_id = uid then
    perform public.contribute_household(t.space_id, p_amount);
    v_source := 'household_contribution';
  end if;
  insert into public.account_transfers (user_id, from_account, to_account, amount_cents, transfer_date, note, source)
  values (uid, p_from, p_to, p_amount, coalesce(p_date, current_date), nullif(left(trim(coalesce(p_note, '')), 80), ''), v_source) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.delete_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from public.account_transfers where id = p_id and user_id = auth.uid();
  if not found then raise exception 'No autorizado'; end if;
end; $$;

-- Ajustar saldo: crea un ajuste visible por la diferencia con el saldo que dice el banco; no borra nada
create or replace function public.adjust_account_balance(p_account uuid, p_target bigint, p_note text)
returns bigint language plpgsql security definer set search_path = public, pg_temp
as $$
declare cur bigint; diff bigint;
begin
  if not exists (select 1 from public.accounts where id = p_account and owner_user_id = auth.uid() and archived_at is null) then raise exception 'No autorizado'; end if;
  if p_target is null or p_target not between -100000000000 and 100000000000 then raise exception 'Importe no válido'; end if;
  cur := public._account_balance(p_account); diff := p_target - cur;
  if diff <> 0 then
    insert into public.account_adjustments (account_id, amount_cents, adjust_date, note) values (p_account, diff, current_date, nullif(left(trim(coalesce(p_note, '')), 80), ''));
  end if;
  return diff;
end; $$;

do $$
declare f text;
begin
  foreach f in array array['save_account(jsonb)', 'archive_account(uuid, boolean)', 'set_movement_account(text, uuid, uuid)', 'set_fund_account(uuid, uuid)',
                           'create_transfer(uuid, uuid, bigint, date, text, text)', 'delete_transfer(uuid)', 'adjust_account_balance(uuid, bigint, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Vaciar un espacio: también sus cuentas comunes y los traspasos que las tocan quedan sin movimientos (las cuentas se conservan)
create or replace function public.clear_space(p_space uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); sp public.spaces; v_users jsonb;
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  select * into sp from public.spaces where id = p_space;
  if not found or sp.created_by is distinct from uid
     or not exists (select 1 from public.space_members m where m.space_id = p_space and m.user_id = uid and m.role = 'owner') then
    raise exception 'No autorizado';
  end if;
  if sp.archived_at is not null then raise exception 'Este espacio está archivado'; end if;
  select coalesce(jsonb_agg(m.user_id), '[]'::jsonb) into v_users
    from public.space_members m where m.space_id = p_space and m.user_id is not null and m.user_id <> uid;
  delete from public.monthly_plans where space_id = p_space;
  delete from public.settlements where space_id = p_space;
  delete from public.cross_offset_lines where space_id = p_space;
  delete from public.contributions where space_id = p_space;
  delete from public.contribution_rules where space_id = p_space;
  delete from public.savings_goals where space_id = p_space;
  delete from public.recurring_expenses where space_id = p_space;
  delete from public.shopping_lists where space_id = p_space;
  delete from public.incomes where space_id = p_space;
  delete from public.expenses where space_id = p_space;
  delete from public.account_transfers t using public.accounts a where a.space_id = p_space and (t.from_account = a.id or t.to_account = a.id);
  delete from public.account_adjustments j using public.accounts a where a.id = j.account_id and a.space_id = p_space;
  if sp.kind = 'personal' then delete from public.loans where user_id = uid; end if;
  return jsonb_build_object('name', sp.name, 'kind', sp.kind, 'others', v_users);
end; $$;
revoke all on function public.clear_space(uuid) from public, anon;
grant execute on function public.clear_space(uuid) to authenticated;
