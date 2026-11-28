-- Ingresos que se repiten: una tabla de reglas (como los gastos fijos). Los cobros siguen siendo filas de `incomes`,
-- así que totales, saldos, meses cerrados y ahorro automático solo cuentan dinero que de verdad ha entrado.
-- «Cada dos semanas» sirve también para los gastos fijos. En esta migración no se usa el valor nuevo, solo se añade.
alter type public.recur_freq add value if not exists 'biweekly';

create table public.income_rules (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  member_id uuid not null references public.space_members(id) on delete cascade,
  source text not null check (char_length(source) between 1 and 60),
  -- En la moneda en la que se cobra; cada cobro se convierte a la del espacio con el cambio de su día
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency char(3) not null check (public.is_supported_currency(currency::text)),
  account_id uuid references public.accounts(id) on delete set null,
  frequency public.recur_freq not null check (frequency <> 'quarterly'),
  day integer not null check (day between 1 and 31),
  next_run date not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index income_rules_space_idx on public.income_rules (space_id);
create index income_rules_due_idx on public.income_rules (next_run) where active;

create table public.income_skips (
  rule_id uuid not null references public.income_rules(id) on delete cascade,
  skip_on date not null,
  created_at timestamptz not null default now(),
  primary key (rule_id, skip_on)
);

alter table public.income_rules enable row level security;
alter table public.income_rules force row level security;
alter table public.income_skips enable row level security;
alter table public.income_skips force row level security;
create policy income_rules_select on public.income_rules for select to authenticated using (public.is_member(space_id));
create policy income_skips_select on public.income_skips for select to authenticated
  using (exists (select 1 from public.income_rules r where r.id = rule_id and public.is_member(r.space_id)));
-- Solo lectura desde fuera: todo cambio pasa por las funciones
revoke all on public.income_rules, public.income_skips from anon, authenticated;
grant select on public.income_rules, public.income_skips to authenticated;
grant select, insert, update, delete on public.income_rules, public.income_skips to service_role;

-- De qué regla salió cada cobro y para qué fecha; el índice único impide duplicarlo aunque el cron corra dos veces
alter table public.incomes add column if not exists rule_id uuid references public.income_rules(id) on delete set null;
alter table public.incomes add column if not exists rule_date date;
create unique index if not exists incomes_rule_date_uidx on public.incomes (rule_id, rule_date) where rule_id is not null;

-- Editar un cobro puede cambiar a la vez el importe y su moneda original sin que esta se pierda
create or replace function public.forget_original_income()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('fifti.currency_change', true), '') <> '1' and coalesce(current_setting('fifti.income_original', true), '') <> '1'
     and new.amount_cents is distinct from old.amount_cents then
    new.original_amount_cents := null; new.original_currency := null;
  end if;
  return new;
end; $$;

drop trigger if exists incomes_zz_account_cents on public.incomes;
create trigger incomes_zz_account_cents before insert or update of account_id, amount_cents, received_at, original_amount_cents, original_currency
  on public.incomes for each row execute function public.set_account_cents();

-- Siguiente fecha de cobro; el mensual usa el último día si el mes no tiene el elegido
create or replace function public._next_income_date(p_date date, p_freq public.recur_freq, p_day integer)
returns date language plpgsql immutable set search_path = public, pg_temp
as $$
declare v_first date;
begin
  if p_freq = 'weekly' then return p_date + 7; end if;
  if p_freq = 'biweekly' then return p_date + 14; end if;
  if p_freq = 'yearly' then return (p_date + interval '1 year')::date; end if;
  v_first := (date_trunc('month', p_date) + interval '1 month')::date;
  return v_first + (least(p_day, extract(day from (v_first + interval '1 month - 1 day'))::integer) - 1);
end; $$;

/* Apunta los cobros vencidos de una regla. Si falta el tipo de cambio se queda esperando (no se salta el cobro);
   un mes cerrado sí se omite. */
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
    v_run := public._next_income_date(v_run, r.frequency, r.day);
  end loop;
  update public.income_rules set next_run = v_run where id = r.id;
  return n;
end; $$;

create or replace function public.process_incomes()
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; n integer := 0;
begin
  for v_id in select id from public.income_rules where active and next_run <= current_date loop
    n := n + public._process_income_rule(v_id);
  end loop;
  return n;
end; $$;

/* Quién puede tocar los ingresos de un miembro: la propia persona, o quien administra si no tiene cuenta. */
create or replace function public._can_income(p_space uuid, p_member uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_full_member(p_space) and exists (
    select 1 from public.space_members m where m.id = p_member and m.space_id = p_space
      and (m.user_id = auth.uid() or (m.user_id is null and public.is_owner(p_space))))
$$;

create or replace function public._check_income_account(p_account uuid, p_space uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if p_account is not null and not exists (
    select 1 from public.accounts a where a.id = p_account and a.archived_at is null
      and (a.owner_user_id = auth.uid() or (a.kind = 'shared' and a.space_id = p_space))) then
    raise exception 'No autorizado';
  end if;
end; $$;

/* Crear o editar un ingreso. `currency` es opcional: sin ella, la del espacio (como hasta ahora). */
create or replace function public.save_income(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_space uuid := (p ->> 'space_id')::uuid; v_member uuid := (p ->> 'member_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_base text; v_cur text; v_entered bigint := (p ->> 'amount_cents')::bigint; v_amount bigint; v_day date := (p ->> 'received_at')::date; v_rate numeric;
begin
  if not public.is_full_member(v_space) then raise exception 'No autorizado'; end if;
  if not exists (select 1 from public.space_members where id = v_member and space_id = v_space) then raise exception 'Miembro ajeno al espacio'; end if;
  if not public._can_income(v_space, v_member) then raise exception 'No autorizado'; end if;
  select base_currency into v_base from public.spaces where id = v_space;
  v_cur := coalesce(nullif(p ->> 'currency', ''), v_base);
  if not public.is_supported_currency(v_cur) then raise exception 'Moneda no válida'; end if;
  v_amount := v_entered;
  if v_cur <> v_base then
    v_rate := public._fx(v_cur, v_base, v_day, true);
    if v_rate is null then raise exception 'No hay tipo de cambio para esa moneda'; end if;
    v_amount := greatest(1, round(v_entered * v_rate))::bigint;
  end if;
  if v_id is null then
    insert into public.incomes (space_id, member_id, amount_cents, currency, source, received_at, is_recurring, original_amount_cents, original_currency)
    values (v_space, v_member, v_amount, v_base, left(btrim(coalesce(p ->> 'source', 'Nómina')), 60), v_day, coalesce((p ->> 'is_recurring')::boolean, false),
            case when v_cur = v_base then null else v_entered end, case when v_cur = v_base then null else v_cur end)
    returning id into v_id;
  else
    perform set_config('fifti.income_original', '1', true);
    update public.incomes i set member_id = v_member, amount_cents = v_amount, source = left(btrim(coalesce(p ->> 'source', 'Nómina')), 60),
      received_at = v_day, is_recurring = i.rule_id is not null or coalesce((p ->> 'is_recurring')::boolean, false),
      original_amount_cents = case when v_cur = v_base then null else v_entered end, original_currency = case when v_cur = v_base then null else v_cur end
    where i.id = v_id and i.space_id = v_space and public._can_income(v_space, i.member_id);
    if not found then raise exception 'Ingreso no encontrado'; end if;
    perform set_config('fifti.income_original', '', true);
  end if;
  return v_id;
end; $$;

/* Crear o editar una regla. `from_income` convierte un cobro ya apuntado en el primero de la serie. */
create or replace function public.save_income_rule(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_space uuid := (p ->> 'space_id')::uuid; v_member uuid := (p ->> 'member_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_account uuid := nullif(p ->> 'account_id', '')::uuid; v_freq public.recur_freq := (p ->> 'frequency')::public.recur_freq;
  v_next date := (p ->> 'next_run')::date; v_day integer := (p ->> 'day')::integer; v_from uuid := nullif(p ->> 'from_income', '')::uuid;
  v_source text := left(btrim(coalesce(p ->> 'source', 'Nómina')), 60); v_first date;
begin
  if not exists (select 1 from public.space_members where id = v_member and space_id = v_space) or not public._can_income(v_space, v_member) then
    raise exception 'No autorizado';
  end if;
  perform public._check_income_account(v_account, v_space);
  if v_next < current_date - 90 or v_next > current_date + 400 then raise exception 'La fecha del primer cobro queda demasiado lejos'; end if;
  if v_id is null then
    if (select count(*) from public.income_rules where space_id = v_space) >= 50 then raise exception 'Demasiados ingresos que se repiten'; end if;
    if v_from is not null then
      select received_at into v_first from public.incomes where id = v_from and space_id = v_space and rule_id is null and public._can_income(v_space, member_id);
      if not found then raise exception 'Ingreso no encontrado'; end if;
      while v_next <= v_first loop v_next := public._next_income_date(v_next, v_freq, v_day); end loop;
    end if;
    insert into public.income_rules (space_id, member_id, source, amount_cents, currency, account_id, frequency, day, next_run)
    values (v_space, v_member, v_source, (p ->> 'amount_cents')::bigint, p ->> 'currency', v_account, v_freq, v_day, v_next)
    returning id into v_id;
    if v_from is not null then update public.incomes set rule_id = v_id, rule_date = received_at, is_recurring = true where id = v_from; end if;
  else
    update public.income_rules r set member_id = v_member, source = v_source, amount_cents = (p ->> 'amount_cents')::bigint, currency = p ->> 'currency',
      account_id = v_account, frequency = v_freq, day = v_day, next_run = v_next
    where r.id = v_id and r.space_id = v_space and public._can_income(v_space, r.member_id);
    if not found then raise exception 'Ingreso no encontrado'; end if;
  end if;
  perform public._process_income_rule(v_id);
  return v_id;
end; $$;

/* Pausar o reanudar. Al reanudar no se recuperan los cobros del tiempo en pausa. */
create or replace function public.set_income_rule_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.income_rules; v_next date;
begin
  select * into r from public.income_rules where id = p_id for update;
  if not found or not public._can_income(r.space_id, r.member_id) then raise exception 'No autorizado'; end if;
  v_next := r.next_run;
  if p_active and not r.active then
    while v_next < current_date loop v_next := public._next_income_date(v_next, r.frequency, r.day); end loop;
  end if;
  update public.income_rules set active = coalesce(p_active, false), next_run = v_next where id = p_id;
  if p_active then perform public._process_income_rule(p_id); end if;
end; $$;

create or replace function public.set_income_skip(p_rule uuid, p_date date, p_skip boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.income_rules;
begin
  select * into r from public.income_rules where id = p_rule;
  if not found or not public._can_income(r.space_id, r.member_id) then raise exception 'No autorizado'; end if;
  if p_date < r.next_run or p_date > current_date + 400 then raise exception 'Esa fecha ya pasó'; end if;
  if p_skip then
    insert into public.income_skips (rule_id, skip_on) values (p_rule, p_date) on conflict do nothing;
  else
    delete from public.income_skips where rule_id = p_rule and skip_on = p_date;
  end if;
end; $$;

-- «Cada dos semanas» también en los gastos fijos
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
      v_run := case r.frequency when 'weekly' then v_run + 7
                 when 'biweekly' then v_run + 14
                 when 'monthly' then (date_trunc('month', v_run) + interval '1 month')::date + (least(r.day, extract(day from (date_trunc('month', v_run) + interval '2 month - 1 day'))::int) - 1)
                 when 'quarterly' then (date_trunc('month', v_run) + interval '3 months')::date + (least(r.day, extract(day from (date_trunc('month', v_run) + interval '4 month - 1 day'))::int) - 1)
                 else (v_run + interval '1 year')::date end;
    end loop;
    update public.recurring_expenses set next_run = v_run, rotation_pos = v_pos where id = r.id;
  end loop;
  return n;
end; $$;

-- Quien se va de un espacio (por su pie o expulsado) deja sus reglas en pausa
create or replace function public.pause_rules_of_leaver()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if old.user_id is not null and new.user_id is null then
    update public.income_rules set active = false, account_id = null where member_id = new.id;
  end if;
  return new;
end; $$;
drop trigger if exists members_pause_income_rules on public.space_members;
create trigger members_pause_income_rules after update of user_id on public.space_members
  for each row execute function public.pause_rules_of_leaver();

-- Al vaciar un espacio también se van sus ingresos que se repiten (si no, seguirían apuntándose)
create or replace function public.clear_space(p_space uuid, p_delete_accounts boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); sp public.spaces; v_users jsonb; v_account uuid; v_accounts integer := 0; v_mine uuid[];
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
  -- Lo mío y lo común del espacio; las cuentas propias de otras personas quedan como están
  select coalesce(array_agg(id), '{}') into v_mine from public.accounts where space_id = p_space and (owner_user_id = uid or kind = 'shared');
  delete from public.monthly_plans where space_id = p_space;
  delete from public.settlements where space_id = p_space;
  delete from public.cross_offset_lines where space_id = p_space;
  delete from public.contributions where space_id = p_space;
  delete from public.contribution_rules where space_id = p_space;
  delete from public.savings_goals where space_id = p_space;
  delete from public.recurring_expenses where space_id = p_space;
  delete from public.income_rules where space_id = p_space;
  delete from public.shopping_lists where space_id = p_space;
  delete from public.incomes where space_id = p_space;
  delete from public.expenses where space_id = p_space;
  delete from public.account_transfers where from_account = any (v_mine) or to_account = any (v_mine);
  delete from public.account_adjustments where account_id = any (v_mine);
  if sp.kind = 'personal' then delete from public.loans where user_id = uid; end if;
  if coalesce(p_delete_accounts, false) then
    for v_account in select id from public.accounts where space_id = p_space and owner_user_id = uid loop
      perform public._delete_account(v_account);
      v_accounts := v_accounts + 1;
    end loop;
    if v_accounts > 0 then
      insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
      values (p_space, uid, 'accounts', p_space, 'delete', jsonb_build_object('cleared_space', true, 'accounts', v_accounts));
    end if;
  end if;
  return jsonb_build_object('name', sp.name, 'kind', sp.kind, 'others', v_users, 'accounts', v_accounts);
end; $$;

/* Borrar una regla de ingreso, con el mismo camino que el resto de borrados. */
create or replace function public.delete_income_rule(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.income_rules;
begin
  select * into r from public.income_rules where id = p_id;
  if not found then return; end if;
  if not public._can_income(r.space_id, r.member_id) then raise exception 'No autorizado'; end if;
  delete from public.income_rules where id = p_id; -- los cobros ya apuntados se quedan
  insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
  values (r.space_id, auth.uid(), 'income_rules', p_id, 'delete', '{}'::jsonb);
end; $$;

-- Lo marcado como «Se repite cada mes» pasa a regla mensual. Si el último cobro tiene más de tres meses, queda en pausa
-- (no se pierde nada y no aparecen cobros que quizá ya no existen).
do $$
declare s record; v_id uuid; v_next date; v_day integer;
begin
  for s in
    select distinct on (i.space_id, i.member_id, i.source) i.* from public.incomes i
    where i.is_recurring and i.rule_id is null order by i.space_id, i.member_id, i.source, i.received_at desc, i.created_at desc
  loop
    v_day := extract(day from s.received_at)::integer;
    v_next := s.received_at;
    loop
      v_next := public._next_income_date(v_next, 'monthly', v_day);
      exit when v_next >= current_date;
    end loop;
    insert into public.income_rules (space_id, member_id, source, amount_cents, currency, account_id, frequency, day, next_run, active)
    values (s.space_id, s.member_id, s.source, coalesce(s.original_amount_cents, s.amount_cents), coalesce(s.original_currency, s.currency),
            s.account_id, 'monthly', v_day, v_next, s.received_at >= current_date - 92)
    returning id into v_id;
    -- Se enlaza el último cobro sin tocar nada más (el disparador de meses cerrados no se activa por estas columnas)
    perform set_config('fifti.reassign', '1', true);
    update public.incomes set rule_id = v_id, rule_date = received_at where id = s.id;
  end loop;
  perform set_config('fifti.reassign', '', true);
end $$;

revoke execute on function public._next_income_date(date, public.recur_freq, integer), public._process_income_rule(uuid), public.process_incomes(),
  public._can_income(uuid, uuid), public._check_income_account(uuid, uuid), public.pause_rules_of_leaver() from public, anon, authenticated;
grant execute on function public.process_incomes() to service_role;
revoke execute on function public.save_income_rule(jsonb), public.set_income_rule_active(uuid, boolean), public.set_income_skip(uuid, date, boolean),
  public.delete_income_rule(uuid) from public, anon;
grant execute on function public.save_income_rule(jsonb), public.set_income_rule_active(uuid, boolean), public.set_income_skip(uuid, date, boolean),
  public.delete_income_rule(uuid) to authenticated;
