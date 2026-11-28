-- «Dos veces al mes» (por ejemplo el 1 y el 15) para ingresos y gastos fijos. Si el mes no tiene el segundo día, se usa el último.
-- El primer día llega como mucho al 27: así cada mes tiene siempre dos fechas distintas.
-- El valor nuevo no se puede usar como literal del tipo en la misma migración que lo añade: las comprobaciones comparan texto.
alter type public.recur_freq add value if not exists 'semimonthly';

alter table public.income_rules add column if not exists day2 integer;
alter table public.recurring_expenses add column if not exists day2 integer;
alter table public.income_rules drop constraint if exists income_rules_day2_check;
alter table public.income_rules add constraint income_rules_day2_check check (
  (frequency::text = 'semimonthly' and day2 is not null and day <= 27 and day2 > day and day2 <= 31) or (frequency::text <> 'semimonthly' and day2 is null));
alter table public.recurring_expenses drop constraint if exists recurring_day2_check;
alter table public.recurring_expenses add constraint recurring_day2_check check (
  (frequency::text = 'semimonthly' and day2 is not null and day <= 27 and day2 > day and day2 <= 31) or (frequency::text <> 'semimonthly' and day2 is null));

drop function if exists public._next_income_date(date, public.recur_freq, integer);

-- Siguiente fecha; los días que el mes no tiene pasan a su último día
create or replace function public._next_income_date(p_date date, p_freq public.recur_freq, p_day integer, p_day2 integer default null)
returns date language plpgsql immutable set search_path = public, pg_temp
as $$
declare v_month date := date_trunc('month', p_date)::date; v_next date := (date_trunc('month', p_date) + interval '1 month')::date; v_last integer; v_second date;
begin
  if p_freq = 'weekly' then return p_date + 7; end if;
  if p_freq = 'biweekly' then return p_date + 14; end if;
  if p_freq = 'yearly' then return (p_date + interval '1 year')::date; end if;
  if p_freq = 'semimonthly' then
    v_last := extract(day from (v_next - 1))::integer;
    if p_date < v_month + (least(p_day, v_last) - 1) then return v_month + (least(p_day, v_last) - 1); end if;
    v_second := v_month + (least(p_day2, v_last) - 1);
    if p_date < v_second then return v_second; end if;
  end if;
  if p_freq = 'quarterly' then v_next := (v_month + interval '3 months')::date; end if;
  v_last := extract(day from (v_next + interval '1 month - 1 day'))::integer;
  return v_next + (least(p_day, v_last) - 1);
end; $$;
revoke execute on function public._next_income_date(date, public.recur_freq, integer, integer) from public, anon, authenticated;

create or replace function public._process_income_rule(p_rule uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.income_rules; v_base text; v_run date; v_rate numeric; v_amount bigint; n integer := 0; i integer := 0; v_count integer;
begin
  select * into r from public.income_rules where id = p_rule and active for update skip locked;
  if not found then return 0; end if;
  select base_currency into v_base from public.spaces where id = r.space_id and archived_at is null;
  if v_base is null then return 0; end if;
  perform set_config('fifti.no_default_account', '1', true);
  v_run := r.next_run;
  while v_run <= current_date and i < 12 loop
    if not exists (select 1 from public.income_skips k where k.rule_id = r.id and k.skip_on = v_run) then
      v_rate := public._fx(r.currency::text, v_base, v_run, true);
      exit when v_rate is null;
      v_amount := greatest(1, round(r.amount_cents * v_rate))::bigint;
      begin
        insert into public.incomes (space_id, member_id, amount_cents, currency, source, received_at, is_recurring, account_id,
                                    original_amount_cents, original_currency, rule_id, rule_date)
        values (r.space_id, r.member_id, v_amount, v_base, r.source, v_run, true, r.account_id,
                case when r.currency::text = v_base then null else r.amount_cents end,
                case when r.currency::text = v_base then null else r.currency end, r.id, v_run)
        on conflict (rule_id, rule_date) where rule_id is not null do nothing;
        get diagnostics v_count = row_count;
        n := n + v_count;
      exception when others then null; -- p. ej. mes cerrado
      end;
    end if;
    i := i + 1;
    v_run := public._next_income_date(v_run, r.frequency, r.day, r.day2);
  end loop;
  update public.income_rules set next_run = v_run where id = r.id;
  return n;
end; $$;

create or replace function public.set_income_rule_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.income_rules; v_next date;
begin
  select * into r from public.income_rules where id = p_id for update;
  if not found or not public._can_income(r.space_id, r.member_id) then raise exception 'No autorizado'; end if;
  v_next := r.next_run;
  if p_active and not r.active then
    while v_next < current_date loop v_next := public._next_income_date(v_next, r.frequency, r.day, r.day2); end loop;
  end if;
  update public.income_rules set active = coalesce(p_active, false), next_run = v_next where id = p_id;
  if p_active then perform public._process_income_rule(p_id); end if;
end; $$;

create or replace function public.save_income_rule(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_space uuid := (p ->> 'space_id')::uuid; v_member uuid := (p ->> 'member_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_account uuid := nullif(p ->> 'account_id', '')::uuid; v_freq public.recur_freq := (p ->> 'frequency')::public.recur_freq;
  v_next date := (p ->> 'next_run')::date; v_day integer := (p ->> 'day')::integer; v_day2 integer := (p ->> 'day2')::integer;
  v_from uuid := nullif(p ->> 'from_income', '')::uuid; v_source text := left(btrim(coalesce(p ->> 'source', 'Nómina')), 60); v_first date;
begin
  if not exists (select 1 from public.space_members where id = v_member and space_id = v_space) or not public._can_income(v_space, v_member) then
    raise exception 'No autorizado';
  end if;
  perform public._check_income_account(v_account, v_space);
  if v_next < current_date - 90 or v_next > current_date + 400 then raise exception 'La fecha del primer cobro queda demasiado lejos'; end if;
  if v_freq::text <> 'semimonthly' then v_day2 := null;
  elsif v_day2 is null or v_day > 27 or v_day2 <= v_day then raise exception 'Elige dos días distintos; el primero, como mucho el 27';
  end if;
  if v_id is null then
    if (select count(*) from public.income_rules where space_id = v_space) >= 50 then raise exception 'Demasiados ingresos que se repiten'; end if;
    if v_from is not null then
      select received_at into v_first from public.incomes where id = v_from and space_id = v_space and rule_id is null and public._can_income(v_space, member_id);
      if not found then raise exception 'Ingreso no encontrado'; end if;
      while v_next <= v_first loop v_next := public._next_income_date(v_next, v_freq, v_day, v_day2); end loop;
    end if;
    insert into public.income_rules (space_id, member_id, source, amount_cents, currency, account_id, frequency, day, day2, next_run)
    values (v_space, v_member, v_source, (p ->> 'amount_cents')::bigint, p ->> 'currency', v_account, v_freq, v_day, v_day2, v_next)
    returning id into v_id;
    if v_from is not null then update public.incomes set rule_id = v_id, rule_date = received_at, is_recurring = true where id = v_from; end if;
  else
    update public.income_rules r set member_id = v_member, source = v_source, amount_cents = (p ->> 'amount_cents')::bigint, currency = p ->> 'currency',
      account_id = v_account, frequency = v_freq, day = v_day, day2 = v_day2, next_run = v_next
    where r.id = v_id and r.space_id = v_space and public._can_income(v_space, r.member_id);
    if not found then raise exception 'Ingreso no encontrado'; end if;
  end if;
  perform public._process_income_rule(v_id);
  return v_id;
end; $$;

create or replace function public.save_recurring(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_space uuid := (p ->> 'space_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; v_me public.space_members; v_paid text := coalesce(p ->> 'paid_from', 'member');
  v_payer uuid := nullif(p ->> 'payer_member_id', '')::uuid; v_cat uuid := nullif(p ->> 'category_id', '')::uuid; v_fund uuid;
  v_rot uuid[] := coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p -> 'rotation', '[]'::jsonb))), '{}');
  v_freq public.recur_freq := coalesce(p ->> 'frequency', 'monthly')::public.recur_freq; v_day integer := (p ->> 'day')::int; v_day2 integer := (p ->> 'day2')::int;
begin
  select * into v_me from public.space_members where space_id = v_space and user_id = auth.uid() and role in ('owner', 'member');
  if not found then raise exception 'No autorizado'; end if;
  if v_freq::text <> 'semimonthly' then v_day2 := null;
  elsif v_day2 is null or v_day > 27 or v_day2 <= v_day then raise exception 'Elige dos días distintos; el primero, como mucho el 27';
  end if;
  if v_paid = 'member' then
    v_payer := coalesce(v_payer, v_me.id);
    if not exists (select 1 from public.space_members where id = v_payer and space_id = v_space) then raise exception 'Pagador no válido'; end if;
  else
    if (select kind from public.spaces where id = v_space) <> 'household' then raise exception 'Pago desde el bote no permitido'; end if;
    v_payer := null;
  end if;
  if cardinality(v_rot) > 0 then
    if v_paid <> 'member' or (select kind from public.spaces where id = v_space) = 'personal' then raise exception 'Los turnos son para gastos pagados por personas en hogares o grupos'; end if;
    if cardinality(v_rot) < 2 or cardinality(v_rot) > 8 or cardinality(v_rot) <> (select count(distinct x) from unnest(v_rot) x) then raise exception 'Turnos no válidos'; end if;
    if (select count(*) from public.space_members where space_id = v_space and id = any (v_rot)) <> cardinality(v_rot) then raise exception 'Turnos no válidos'; end if;
    v_payer := v_rot[1];
  end if;
  if v_cat is not null then
    select fund_id into v_fund from public.categories where id = v_cat and space_id = v_space;
    if v_fund is null then raise exception 'Categoría ajena al espacio'; end if;
  end if;
  if v_id is null then
    insert into public.recurring_expenses (space_id, fund_id, category_id, description, amount_cents, frequency, day, day2, next_run, payer_member_id, paid_from, detected, rotation)
    values (v_space, v_fund, v_cat, btrim(p ->> 'description'), (p ->> 'amount_cents')::bigint, v_freq,
            v_day, v_day2, (p ->> 'next_run')::date, v_payer, v_paid, coalesce((p ->> 'detected')::boolean, false), v_rot)
    returning id into v_id;
  else
    update public.recurring_expenses set fund_id = v_fund, category_id = v_cat, description = btrim(p ->> 'description'), amount_cents = (p ->> 'amount_cents')::bigint,
      frequency = v_freq, day = v_day, day2 = v_day2, next_run = (p ->> 'next_run')::date,
      payer_member_id = v_payer, paid_from = v_paid, active = coalesce((p ->> 'active')::boolean, true),
      rotation_pos = case when rotation is distinct from v_rot then 0 else rotation_pos end, rotation = v_rot
    where id = v_id and space_id = v_space;
    if not found then raise exception 'Gasto fijo no encontrado'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.process_recurring()
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.recurring_expenses; n integer := 0; v_run date; v_exp uuid; v_cur char(3); v_creator uuid; v_payer uuid; v_pos integer; v_n integer; i integer; s record;
begin
  for r in select * from public.recurring_expenses where active and next_run <= current_date for update skip locked loop
    select base_currency into v_cur from public.spaces where id = r.space_id and archived_at is null;
    continue when v_cur is null;
    v_n := coalesce(cardinality(r.rotation), 0); v_pos := r.rotation_pos;
    v_run := r.next_run; i := 0;
    while v_run <= current_date and i < 12 loop
      if exists (select 1 from public.recurring_skips k where k.recurring_id = r.id and k.skip_on = v_run) then
        null; -- ocurrencia saltada: no se crea el gasto ni gira el turno
      else
        v_payer := case when r.paid_from = 'member' and v_n > 1 then r.rotation[(v_pos % v_n) + 1] else r.payer_member_id end;
        v_creator := coalesce(v_payer, (select id from public.space_members where space_id = r.space_id and role = 'owner' limit 1));
        begin
          insert into public.expenses (space_id, client_id, description, category_id, spent_at, amount_cents, currency, amount_base_cents, paid_from, split_mode, recurring_id, created_by_member)
          values (r.space_id, gen_random_uuid(), r.description, r.category_id, v_run, r.amount_cents, v_cur, r.amount_cents, r.paid_from, 'default', r.id, v_creator)
          returning id into v_exp;
          if r.paid_from = 'member' then insert into public.expense_payers values (v_exp, v_payer, r.amount_cents); end if;
          for s in select * from public._default_split(r.space_id, r.amount_cents) loop
            insert into public.expense_splits values (v_exp, s.member_id, s.share_bp, s.amount_cents);
          end loop;
          n := n + 1; v_pos := v_pos + 1;
        exception when others then null; -- p. ej. mes cerrado: se omite ese cobro y se sigue
        end;
      end if;
      i := i + 1;
      v_run := public._next_income_date(v_run, r.frequency, r.day, r.day2);
    end loop;
    update public.recurring_expenses set next_run = v_run, rotation_pos = v_pos where id = r.id;
  end loop;
  return n;
end; $$;
