-- Varias monedas: moneda por cuenta y por préstamo, cambio de la moneda de un espacio y reflejos entre espacios de monedas distintas.
-- Es compatible con la versión anterior de la app: se puede aplicar antes de desplegar.

create or replace function public.is_supported_currency(p text)
returns boolean language sql immutable
as $$ select p in ('EUR','USD','GBP','CHF','JPY','CAD','AUD','SEK','NOK','DKK','PLN','CZK','HUF','TRY','MXN','BRL') $$;

-- NOT VALID: se exige en todo lo que se escriba desde ahora sin bloquear filas antiguas
alter table public.spaces add constraint spaces_currency_supported check (public.is_supported_currency(base_currency::text)) not valid;
alter table public.expenses add constraint expenses_currency_supported check (public.is_supported_currency(currency::text)) not valid;
alter table public.incomes add constraint incomes_currency_supported check (public.is_supported_currency(currency::text)) not valid;

-- ───────── Columnas nuevas ─────────
alter table public.accounts add column currency char(3);
update public.accounts a set currency = s.base_currency from public.spaces s where s.id = a.space_id;
alter table public.accounts alter column currency set not null;
alter table public.accounts add constraint accounts_currency_supported check (public.is_supported_currency(currency::text)) not valid;

-- Lo que movió la cuenta, en la moneda de la cuenta. Nulo en filas antiguas: entonces la cuenta usa la moneda del espacio
alter table public.expenses add column account_cents bigint;
alter table public.incomes add column account_cents bigint;
-- Importe tal y como se apuntó, si después cambió la moneda del espacio
alter table public.incomes add column original_amount_cents bigint check (original_amount_cents > 0),
  add column original_currency char(3) check (public.is_supported_currency(original_currency::text));

-- Traspaso entre monedas distintas: lo que llega (nulo = lo mismo que sale)
alter table public.account_transfers add column to_amount_cents bigint check (to_amount_cents > 0 and to_amount_cents <= 100000000000);

-- Todos los espacios personales existentes están en euros (hasta ahora no se podía cambiar)
alter table public.loans add column currency char(3) not null default 'EUR';
alter table public.loans alter column currency drop default;
alter table public.loans add constraint loans_currency_supported check (public.is_supported_currency(currency::text)) not valid;

alter table public.profiles add column view_currency char(3) check (public.is_supported_currency(view_currency::text));
grant update (view_currency) on public.profiles to authenticated;

create or replace function public.default_currency()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.currency is null then
    if tg_table_name = 'accounts' then
      select base_currency into new.currency from public.spaces where id = new.space_id;
    else
      select base_currency into new.currency from public.spaces where kind = 'personal' and created_by = new.user_id;
    end if;
    new.currency := coalesce(new.currency, 'EUR');
  end if;
  return new;
end; $$;
create trigger accounts_default_currency before insert on public.accounts for each row execute function public.default_currency();
create trigger loans_default_currency before insert on public.loans for each row execute function public.default_currency();

-- ───────── Tipos de cambio (solo de la caché que escribe el servidor) ─────────
-- 1 unidad de p_from = X de p_to. Busca el día pedido o hasta 10 días antes; con p_loose, el más cercano que haya.
create or replace function public._fx(p_from text, p_to text, p_day date, p_loose boolean default false)
returns numeric language sql stable security definer set search_path = public, pg_temp
as $$
  select case when p_from = p_to then 1 else coalesce(
    (select r.rate from public.fx_rates r where r.base = p_from and r.quote = p_to
       and r.day <= least(p_day, current_date) and r.day >= least(p_day, current_date) - 10 order by r.day desc limit 1),
    case when p_loose then
      (select r.rate from public.fx_rates r where r.base = p_from and r.quote = p_to order by abs(r.day - p_day) limit 1) end)
  end
$$;

create or replace function public._conv(p_amount bigint, p_rate numeric, p_min bigint default 0)
returns bigint language plpgsql immutable
as $$
begin
  if p_rate is null then raise exception 'Falta algún tipo de cambio. No se ha cambiado nada.'; end if;
  return greatest(p_min, round(p_amount * p_rate))::bigint;
end; $$;

revoke all on function public._fx(text, text, date, boolean) from public, anon, authenticated;
revoke all on function public.default_currency() from public, anon, authenticated;

-- ───────── Importe en la moneda de la cuenta ─────────
create or replace function public.set_account_cents()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare r jsonb := to_jsonb(new); v_acc text; v_space text; v_cur text; v_amount bigint; v_day date; v_rate numeric;
begin
  -- Al cambiar la moneda de un espacio las cuentas no se mueven
  if tg_op = 'UPDATE' and coalesce(current_setting('fifti.currency_change', true), '') = '1' then return new; end if;
  if new.account_id is null then new.account_cents := null; return new; end if;
  select currency into v_acc from public.accounts where id = new.account_id;
  select base_currency into v_space from public.spaces where id = new.space_id;
  if tg_table_name = 'expenses' then
    v_cur := r ->> 'currency'; v_amount := (r ->> 'amount_cents')::bigint; v_day := (r ->> 'spent_at')::date;
    if v_cur <> v_acc and v_space = v_acc then v_cur := v_space; v_amount := (r ->> 'amount_base_cents')::bigint; end if;
  else
    v_cur := coalesce(r ->> 'original_currency', r ->> 'currency'); v_amount := coalesce((r ->> 'original_amount_cents')::bigint, (r ->> 'amount_cents')::bigint);
    v_day := (r ->> 'received_at')::date;
  end if;
  if v_cur = v_acc then new.account_cents := v_amount; return new; end if;
  v_rate := public._fx(v_cur, v_acc, v_day, true);
  if v_rate is null then raise exception 'No hay tipo de cambio para la moneda de esa cuenta'; end if;
  new.account_cents := greatest(1, round(v_amount * v_rate))::bigint;
  return new;
end; $$;
revoke all on function public.set_account_cents() from public, anon, authenticated;
-- El nombre empieza por zz para ejecutarse después de asignar la cuenta por defecto
create trigger expenses_zz_account_cents before insert or update of account_id, amount_cents, currency, spent_at on public.expenses
  for each row execute function public.set_account_cents();
create trigger incomes_zz_account_cents before insert or update of account_id, amount_cents, received_at on public.incomes
  for each row execute function public.set_account_cents();

create or replace function public._account_balance(p_account uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp
as $$
  select a.opening_cents
    + coalesce((select sum(coalesce(i.account_cents, i.amount_cents)) from public.incomes i where i.account_id = a.id and i.received_at >= a.opening_date), 0)
    - coalesce((select sum(coalesce(e.account_cents, e.amount_base_cents)) from public.expenses e where e.account_id = a.id and e.spent_at >= a.opening_date), 0)
    + coalesce((select sum(coalesce(t.to_amount_cents, t.amount_cents)) from public.account_transfers t where t.to_account = a.id and t.transfer_date >= a.opening_date), 0)
    - coalesce((select sum(t.amount_cents) from public.account_transfers t where t.from_account = a.id and t.transfer_date >= a.opening_date), 0)
    + coalesce((select sum(j.amount_cents) from public.account_adjustments j where j.account_id = a.id and j.adjust_date >= a.opening_date), 0)
  from public.accounts a where a.id = p_account;
$$;

-- ───────── Cuentas con moneda ─────────
create or replace function public.save_account(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); v_id uuid := nullif(p ->> 'id', '')::uuid; v_space uuid := (p ->> 'space_id')::uuid; sp public.spaces;
        v_kind public.account_kind := coalesce(nullif(p ->> 'kind', ''), 'daily')::public.account_kind; a public.accounts; v_default boolean := coalesce((p ->> 'is_default')::boolean, false);
        v_cur text := nullif(p ->> 'currency', '');
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  if v_cur is not null and not public.is_supported_currency(v_cur) then raise exception 'Moneda no válida'; end if;
  if v_id is not null then
    select * into a from public.accounts where id = v_id;
    if not found or a.owner_user_id <> uid then raise exception 'No autorizado'; end if;
    v_space := a.space_id;
    if v_cur is not null and v_cur <> a.currency
       and (exists (select 1 from public.expenses where account_id = v_id) or exists (select 1 from public.incomes where account_id = v_id)
            or exists (select 1 from public.account_transfers where from_account = v_id or to_account = v_id)
            or exists (select 1 from public.account_adjustments where account_id = v_id)) then
      raise exception 'No se puede cambiar la moneda de una cuenta con movimientos';
    end if;
  end if;
  select * into sp from public.spaces where id = v_space;
  if not found or not public.is_member(v_space) or sp.archived_at is not null then raise exception 'No autorizado'; end if;
  if v_kind = 'shared' and sp.kind = 'personal' then raise exception 'Una cuenta común va en un hogar o un grupo'; end if;
  if v_id is null then
    if (select count(*) from public.accounts where owner_user_id = uid and archived_at is null) >= 20 then raise exception 'Demasiadas cuentas'; end if;
    if not exists (select 1 from public.accounts where owner_user_id = uid and space_id = v_space and archived_at is null) then v_default := true; end if;
    insert into public.accounts (space_id, owner_user_id, name, bank, color, kind, opening_cents, opening_date, is_default, currency)
    values (v_space, uid, left(trim(p ->> 'name'), 60), nullif(left(trim(coalesce(p ->> 'bank', '')), 60), ''), coalesce(nullif(p ->> 'color', ''), '#9AA3AF'), v_kind,
            coalesce((p ->> 'opening_cents')::bigint, 0), coalesce(nullif(p ->> 'opening_date', '')::date, current_date), v_default, coalesce(v_cur, sp.base_currency))
    returning id into v_id;
  else
    update public.accounts set name = left(trim(p ->> 'name'), 60), bank = nullif(left(trim(coalesce(p ->> 'bank', '')), 60), ''),
      color = coalesce(nullif(p ->> 'color', ''), color), kind = v_kind, opening_cents = coalesce((p ->> 'opening_cents')::bigint, opening_cents),
      opening_date = coalesce(nullif(p ->> 'opening_date', '')::date, opening_date), currency = coalesce(v_cur, currency) where id = v_id;
  end if;
  if v_default then
    update public.accounts set is_default = (id = v_id) where owner_user_id = uid and space_id = v_space;
  end if;
  return v_id;
end; $$;

-- ───────── Traspasos entre monedas ─────────
drop function public.create_transfer(uuid, uuid, bigint, date, text, text);
create function public.create_transfer(p_from uuid, p_to uuid, p_amount bigint, p_date date, p_note text, p_source text, p_to_amount bigint default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); f public.accounts; t public.accounts; v_id uuid; v_source text := coalesce(p_source, 'manual'); sp public.spaces;
        v_to bigint; v_home bigint;
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Importe no válido'; end if;
  if p_from = p_to then raise exception 'Elige dos cuentas distintas'; end if;
  if v_source not in ('manual', 'payroll_split', 'household_contribution') then raise exception 'Datos no válidos'; end if;
  select * into f from public.accounts where id = p_from and archived_at is null;
  select * into t from public.accounts where id = p_to and archived_at is null;
  if f.id is null or t.id is null or not public.can_see_account(p_from) or not public.can_see_account(p_to) then raise exception 'No autorizado'; end if;
  if f.owner_user_id <> uid then raise exception 'Solo puedes sacar dinero de tus cuentas'; end if;
  if f.currency <> t.currency then
    if p_to_amount is null or p_to_amount <= 0 or p_to_amount > 100000000000 then raise exception 'Pon el importe que llega'; end if;
    v_to := p_to_amount;
  end if;
  select * into sp from public.spaces where id = t.space_id;
  if t.kind = 'shared' and sp.kind = 'household' then
    -- la aportación se cuenta en la moneda del hogar
    v_home := case when t.currency = sp.base_currency then coalesce(v_to, p_amount)
                   when f.currency = sp.base_currency then p_amount
                   else public._conv(p_amount, public._fx(f.currency, sp.base_currency, coalesce(p_date, current_date), true), 1) end;
    perform public.contribute_household(t.space_id, v_home);
    v_source := 'household_contribution';
  end if;
  insert into public.account_transfers (user_id, from_account, to_account, amount_cents, to_amount_cents, transfer_date, note, source)
  values (uid, p_from, p_to, p_amount, v_to, coalesce(p_date, current_date), nullif(left(trim(coalesce(p_note, '')), 80), ''), v_source) returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.create_transfer(uuid, uuid, bigint, date, text, text, bigint) from public, anon;
grant execute on function public.create_transfer(uuid, uuid, bigint, date, text, text, bigint) to authenticated;

-- ───────── Reflejo en Personal y aportaciones, aunque las monedas sean distintas ─────────
create or replace function public._mirror_apply(p_expense uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare e public.expenses; m public.space_members; s public.spaces; sp_amount bigint; v_personal uuid; v_fund uuid; v_pcur char(3); v_rate numeric;
begin
  select * into e from public.expenses where id = p_expense;
  select * into m from public.space_members where id = p_member;
  if e.id is null or m.user_id is null then return; end if;
  select * into s from public.spaces where id = e.space_id;
  if s.kind = 'personal' then return; end if;
  select amount_cents into sp_amount from public.expense_splits where expense_id = p_expense and member_id = p_member;
  select id, base_currency into v_personal, v_pcur from public.spaces where created_by = m.user_id and kind = 'personal';
  v_fund := case when e.paid_from = 'member' and sp_amount is not null and v_personal is not null
                 then public._mirror_target(m.user_id, s.id, e.category_id) else null end;
  if v_fund is not null then
    v_rate := public._fx(s.base_currency, v_pcur, e.spent_at, true);
    if v_rate is null and coalesce(current_setting('fifti.currency_change', true), '') = '1' then
      raise exception 'Falta algún tipo de cambio. No se ha cambiado nada.';
    end if;
  end if;
  if v_fund is null or v_rate is null then
    delete from public.personal_mirror where user_id = m.user_id and source_expense_id = p_expense;
  else
    insert into public.personal_mirror (user_id, source_expense_id, personal_space_id, fund_id, amount_cents, spent_at, label)
    values (m.user_id, p_expense, v_personal, v_fund, round(sp_amount * v_rate)::bigint, e.spent_at, left(s.name, 60))
    on conflict (user_id, source_expense_id) do update set fund_id = excluded.fund_id, amount_cents = excluded.amount_cents, spent_at = excluded.spent_at, label = excluded.label;
  end if;
end; $$;

create or replace function public.mark_contribution_paid(p_id uuid, p_paid bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.contributions; m public.space_members; sp public.spaces; v_ps uuid; v_pm uuid; v_cat uuid; v_exp uuid; v_pcur char(3); v_rate numeric; v_base bigint;
begin
  select * into c from public.contributions where id = p_id for update;
  if not found then raise exception 'Aportación no encontrada'; end if;
  select * into m from public.space_members where id = c.member_id;
  if not (m.user_id = auth.uid() or public.is_owner(c.space_id)) then raise exception 'No autorizado'; end if;
  if p_paid is null or p_paid < 0 or p_paid > 100000000000 then raise exception 'Importe no válido'; end if;
  select * into sp from public.spaces where id = c.space_id;

  if c.personal_expense_id is not null then delete from public.expenses where id = c.personal_expense_id; end if;
  v_exp := null;
  if p_paid > 0 and m.user_id is not null then
    select s.id, s.base_currency into v_ps, v_pcur from public.spaces s where s.created_by = m.user_id and s.kind = 'personal';
    v_rate := public._fx(sp.base_currency, v_pcur, current_date, true);
    if v_ps is not null and v_rate is not null then
      v_base := greatest(1, round(p_paid * v_rate))::bigint;
      select id into v_pm from public.space_members where space_id = v_ps and user_id = m.user_id;
      select cat.id into v_cat from public.categories cat join public.funds f on f.id = cat.fund_id
        where cat.space_id = v_ps and f.kind = 'contribution' limit 1;
      insert into public.expenses (space_id, client_id, description, category_id, spent_at, amount_cents, currency, fx_rate, amount_base_cents,
                                   paid_from, split_mode, created_by_member)
      values (v_ps, gen_random_uuid(), left('Aportación a ' || sp.name, 120), v_cat, current_date, p_paid, sp.base_currency, v_rate, v_base, 'member', 'equal', v_pm)
      returning id into v_exp;
      insert into public.expense_payers values (v_exp, v_pm, v_base);
      insert into public.expense_splits values (v_exp, v_pm, 10000, v_base);
    end if;
  end if;
  update public.contributions set paid_cents = p_paid, paid_at = case when p_paid > 0 then current_date else null end, personal_expense_id = v_exp where id = p_id;
end; $$;

-- El redondeo para metas se calcula en la moneda del espacio
create or replace function public.apply_roundup()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; v_amt bigint;
begin
  if (select kind from public.spaces where id = new.space_id) <> 'personal' then return null; end if;
  delete from public.goal_contributions where source_expense_id = new.id and source = 'roundup';
  for r in select goal_id, value from public.saving_rules where space_id = new.space_id and kind = 'roundup' and active loop
    v_amt := case when new.amount_base_cents % r.value = 0 then 0 else r.value - (new.amount_base_cents % r.value) end;
    if v_amt > 0 then
      insert into public.goal_contributions (goal_id, space_id, member_id, amount_cents, source, source_expense_id, contributed_at)
      values (r.goal_id, new.space_id, new.created_by_member, v_amt, 'roundup', new.id, new.spent_at);
    end if;
  end loop;
  return null;
end; $$;

-- Editar un ingreso cambiando su importe hace que deje de contar el original
create or replace function public.forget_original_income()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('fifti.currency_change', true), '') <> '1' and new.amount_cents is distinct from old.amount_cents then
    new.original_amount_cents := null; new.original_currency := null;
  end if;
  return new;
end; $$;
create trigger incomes_forget_original before update of amount_cents on public.incomes for each row execute function public.forget_original_income();

create or replace function public.block_closed_month()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare rec jsonb;
begin
  -- El cambio de moneda recalcula también los meses cerrados: no añade ni quita movimientos
  if pg_trigger_depth() > 1 or (tg_op = 'UPDATE' and coalesce(current_setting('fifti.currency_change', true), '') = '1') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    rec := to_jsonb(new);
    if public._month_closed((rec ->> 'space_id')::uuid, coalesce(rec ->> 'spent_at', rec ->> 'received_at')::date) then
      raise exception 'Ese mes está cerrado: reábrelo para cambiar sus movimientos';
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    rec := to_jsonb(old);
    if public._month_closed((rec ->> 'space_id')::uuid, coalesce(rec ->> 'spent_at', rec ->> 'received_at')::date) then
      raise exception 'Ese mes está cerrado: reábrelo para cambiar sus movimientos';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end; $$;

-- Compensar solo tiene sentido entre espacios con la misma moneda
create or replace function public.check_offset_currency()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.cross_offset_lines l join public.spaces s on s.id = l.space_id
             join public.spaces mine on mine.id = new.space_id where l.offset_id = new.offset_id and s.base_currency <> mine.base_currency) then
    raise exception 'Solo se pueden compensar deudas en la misma moneda';
  end if;
  return new;
end; $$;
revoke all on function public.check_offset_currency() from public, anon, authenticated;
create trigger offset_lines_currency before insert on public.cross_offset_lines for each row execute function public.check_offset_currency();

-- ───────── Cambiar la moneda de un espacio ─────────
-- Qué cambios hacen falta (para que el servidor los tenga en la caché antes). Solo el servidor: incluye monedas de otras personas.
create or replace function public.currency_change_needs(p_space uuid, p_currency text)
returns table (from_currency text, to_currency text, day date) language sql stable security definer set search_path = public, pg_temp
as $$
  with s as (select * from public.spaces where id = p_space)
  select e.currency::text, p_currency, e.spent_at from public.expenses e where e.space_id = p_space and e.currency <> p_currency
  union select coalesce(i.original_currency, i.currency)::text, p_currency, i.received_at from public.incomes i
    where i.space_id = p_space and coalesce(i.original_currency, i.currency) <> p_currency
  union select s.base_currency::text, p_currency, t.settled_at from s join public.settlements t on t.space_id = s.id
  union select s.base_currency::text, p_currency, current_date from s
  -- reflejos: en Personal llegan gastos de otros espacios…
  union select o.base_currency::text, p_currency, e.spent_at from s
    join public.space_members m on m.user_id = s.created_by
    join public.expense_splits sp on sp.member_id = m.id
    join public.expenses e on e.id = sp.expense_id
    join public.spaces o on o.id = e.space_id and o.kind <> 'personal'
    where s.kind = 'personal' and o.base_currency <> p_currency
  -- …y desde un hogar o grupo salen hacia el Personal de cada miembro
  union select p_currency, ps.base_currency::text, e.spent_at from s
    join public.expenses e on e.space_id = s.id
    join public.expense_splits sp on sp.expense_id = e.id
    join public.space_members m on m.id = sp.member_id
    join public.spaces ps on ps.created_by = m.user_id and ps.kind = 'personal'
    where s.kind <> 'personal' and ps.base_currency <> p_currency
$$;
revoke all on function public.currency_change_needs(uuid, text) from public, anon, authenticated;
grant execute on function public.currency_change_needs(uuid, text) to service_role;

create or replace function public.change_space_currency(p_space_id uuid, p_currency text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); sp public.spaces; v_old text; r numeric; e record; i record; t record; v_base bigint; v_rate numeric; v_count integer := 0;
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  select * into sp from public.spaces where id = p_space_id for update;
  if not found or not public.is_owner(p_space_id) or (sp.kind = 'personal' and sp.created_by is distinct from uid) then raise exception 'No autorizado'; end if;
  if p_currency is null or not public.is_supported_currency(p_currency) then raise exception 'Moneda no válida'; end if;
  if sp.archived_at is not null then raise exception 'Este espacio está archivado'; end if;
  v_old := sp.base_currency;
  if v_old = p_currency then return; end if;
  if not public.rate_limit_hit('currency-change:' || uid::text, 10, 3600) then raise exception 'Demasiados intentos. Espera un rato.'; end if;
  r := public._fx(v_old, p_currency, current_date);
  if r is null then raise exception 'Falta algún tipo de cambio. No se ha cambiado nada.'; end if;

  perform set_config('fifti.currency_change', '1', true);
  -- Las cuentas no cambian: se fija lo que movieron antes de recalcular
  update public.expenses set account_cents = amount_base_cents where space_id = p_space_id and account_id is not null and account_cents is null;
  update public.incomes set account_cents = amount_cents where space_id = p_space_id and account_id is not null and account_cents is null;
  update public.spaces set base_currency = p_currency where id = p_space_id;

  -- Gastos: el importe y la moneda originales no se tocan; se recalcula el cambio de su fecha, el total y el reparto
  for e in select id, amount_cents, currency, spent_at, amount_base_cents from public.expenses where space_id = p_space_id loop
    v_rate := public._fx(e.currency, p_currency, e.spent_at);
    v_base := public._conv(e.amount_cents, v_rate, 1);
    update public.expenses set fx_rate = v_rate, amount_base_cents = v_base where id = e.id;
    -- reparto proporcional: la suma cuadra al céntimo (los restos van a las fracciones mayores)
    with q as (
      select member_id, floor(amount_cents::numeric * v_base / e.amount_base_cents)::bigint as whole,
             (amount_cents::numeric * v_base / e.amount_base_cents) % 1 as frac
      from public.expense_splits where expense_id = e.id),
    n as (select member_id, whole + case when row_number() over (order by frac desc, member_id) <= v_base - sum(whole) over () then 1 else 0 end as cents from q)
    update public.expense_splits s set amount_cents = n.cents from n where s.expense_id = e.id and s.member_id = n.member_id;
    with q as (
      select member_id, floor(amount_cents::numeric * v_base / e.amount_base_cents)::bigint as whole,
             (amount_cents::numeric * v_base / e.amount_base_cents) % 1 as frac
      from public.expense_payers where expense_id = e.id),
    n as (select member_id, whole + case when row_number() over (order by frac desc, member_id) <= v_base - sum(whole) over () then 1 else 0 end as cents from q),
    gone as (delete from public.expense_payers p using n where p.expense_id = e.id and p.member_id = n.member_id and n.cents = 0)
    update public.expense_payers p set amount_cents = n.cents from n where p.expense_id = e.id and p.member_id = n.member_id and n.cents > 0;
    v_count := v_count + 1;
  end loop;

  -- Ingresos: al cambio de su fecha, guardando lo que se apuntó
  for i in select id, coalesce(original_amount_cents, amount_cents) as amount, coalesce(original_currency, currency)::text as cur, received_at from public.incomes where space_id = p_space_id loop
    update public.incomes set amount_cents = public._conv(i.amount, public._fx(i.cur, p_currency, i.received_at), 1), currency = p_currency,
      original_amount_cents = case when i.cur = p_currency then null else i.amount end,
      original_currency = case when i.cur = p_currency then null else i.cur end where id = i.id;
  end loop;

  -- Pagos ya hechos: al cambio de su fecha
  for t in select id, amount_cents, settled_at from public.settlements where space_id = p_space_id loop
    update public.settlements set amount_cents = public._conv(t.amount_cents, public._fx(v_old, p_currency, t.settled_at), 1) where id = t.id;
  end loop;

  -- Importes fijos y planes: al cambio de hoy
  update public.recurring_expenses set amount_cents = public._conv(amount_cents, r, 1) where space_id = p_space_id;
  update public.favorites set amount_cents = public._conv(amount_cents, r, 1) where space_id = p_space_id;
  update public.plan_incomes set expected_cents = public._conv(expected_cents, r) where plan_id in (select id from public.monthly_plans where space_id = p_space_id);
  update public.plan_allocations set value = case when mode = 'amount' then public._conv(value, r) else value end,
    planned_cents = public._conv(planned_cents, r), carry_cents = public._conv(carry_cents, r)
    where plan_id in (select id from public.monthly_plans where space_id = p_space_id);
  update public.plan_close_decisions set leftover_cents = public._conv(leftover_cents, r, -100000000000)
    where plan_id in (select id from public.monthly_plans where space_id = p_space_id);
  update public.contribution_rules set monthly_target_cents = public._conv(monthly_target_cents, r),
    values = case when mode = 'fixed_amount' then coalesce((select jsonb_object_agg(k, public._conv(v::bigint, r)) from jsonb_each_text(values) as j(k, v)), '{}'::jsonb) else values end
    where space_id = p_space_id;
  update public.contributions set expected_cents = public._conv(expected_cents, r), paid_cents = public._conv(paid_cents, r) where space_id = p_space_id;
  update public.savings_goals set target_cents = public._conv(target_cents, r, 1) where space_id = p_space_id;
  update public.goal_contributions set amount_cents = public._conv(amount_cents, r, 1) where space_id = p_space_id;
  update public.goal_milestones set amount_cents = public._conv(amount_cents, r, 1) where space_id = p_space_id;
  update public.saving_rules set value = public._conv(value, r, 1) where space_id = p_space_id and kind = 'weekly_challenge';
  update public.spaces set daily_budget_cents = public._conv(daily_budget_cents, r, 1) where id = p_space_id and daily_budget_cents is not null;
  update public.cross_offsets set status = 'rejected' where status = 'proposed' and id in (select offset_id from public.cross_offset_lines where space_id = p_space_id);
  update public.cross_offset_lines set amount_cents = public._conv(amount_cents, r, 1) where space_id = p_space_id;

  -- Personal: las partes de otros espacios se recalculan a la moneda nueva
  if sp.kind = 'personal' then
    for e in select x.id as expense_id, m.id as member_id from public.space_members m
             join public.expense_splits s on s.member_id = m.id join public.expenses x on x.id = s.expense_id
             join public.spaces o on o.id = x.space_id and o.kind <> 'personal' where m.user_id = uid loop
      perform public._mirror_apply(e.expense_id, e.member_id);
    end loop;
  end if;

  insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
  values (p_space_id, uid, 'spaces', p_space_id, 'update', jsonb_build_object('old', jsonb_build_object('base_currency', v_old),
          'new', jsonb_build_object('base_currency', p_currency), 'rate_today', r, 'expenses', v_count));
  perform set_config('fifti.currency_change', '', true);
end; $$;
revoke all on function public.change_space_currency(uuid, text) from public, anon;
grant execute on function public.change_space_currency(uuid, text) to authenticated;
