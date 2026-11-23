-- Fase 6: plan mensual, fondos asignados, bote común, aportaciones, gastos fijos recurrentes.

create type public.plan_status as enum ('draft', 'active', 'closed');
create type public.alloc_mode as enum ('percent', 'amount');
create type public.contrib_mode as enum ('proportional_to_income', 'fixed_percent', 'fixed_amount');

create table public.monthly_plans (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  status public.plan_status not null default 'active',
  notes text check (notes is null or char_length(notes) <= 500),
  closed_at timestamptz,
  unique (space_id, month),
  unique (id, space_id)
);
create table public.plan_incomes (
  plan_id uuid not null references public.monthly_plans (id) on delete cascade,
  member_id uuid not null references public.space_members (id),
  expected_cents bigint not null check (expected_cents >= 0 and expected_cents <= 100000000000),
  primary key (plan_id, member_id)
);
create table public.plan_allocations (
  plan_id uuid not null references public.monthly_plans (id) on delete cascade,
  fund_id uuid not null references public.funds (id) on delete cascade,
  mode public.alloc_mode not null,
  value bigint not null check (value >= 0 and value <= 100000000000),
  planned_cents bigint not null check (planned_cents >= 0 and planned_cents <= 100000000000),
  primary key (plan_id, fund_id),
  check (mode <> 'percent' or value <= 10000)
);

create table public.contribution_rules (
  space_id uuid primary key references public.spaces (id) on delete cascade,
  mode public.contrib_mode not null default 'proportional_to_income',
  monthly_target_cents bigint not null default 0 check (monthly_target_cents >= 0 and monthly_target_cents <= 100000000000),
  values jsonb not null default '{}'::jsonb
);
create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  member_id uuid not null references public.space_members (id),
  month date not null check (extract(day from month) = 1),
  expected_cents bigint not null check (expected_cents >= 0 and expected_cents <= 100000000000),
  paid_cents bigint not null default 0 check (paid_cents >= 0 and paid_cents <= 100000000000),
  paid_at date,
  personal_expense_id uuid references public.expenses (id) on delete set null,
  unique (space_id, member_id, month)
);

create type public.recur_freq as enum ('weekly', 'monthly', 'yearly');
create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  fund_id uuid references public.funds (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  description text not null check (char_length(description) between 1 and 120),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  frequency public.recur_freq not null default 'monthly',
  day integer not null default 1 check (day between 1 and 31),
  next_run date not null,
  active boolean not null default true,
  detected boolean not null default false,
  payer_member_id uuid references public.space_members (id),
  paid_from text not null default 'member' check (paid_from in ('member', 'pot')),
  created_at timestamptz not null default now()
);
alter table public.expenses add constraint expenses_recurring_fk foreign key (recurring_id) references public.recurring_expenses (id) on delete set null;

-- ───────── Reparto por defecto en SQL (mayor resto) ─────────
create or replace function public._default_split(p_space uuid, p_total bigint)
returns table (member_id uuid, share_bp integer, amount_cents bigint)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_tot bigint; v_left bigint;
begin
  select sum(coalesce(default_share_bp, 0)) into v_tot from public.space_members where space_id = p_space;
  if coalesce(v_tot, 0) = 0 then
    return query select m.id, 0, 0::bigint from public.space_members m where false; -- sin reparto configurado
    return;
  end if;
  return query
  with base as (
    select m.id, coalesce(m.default_share_bp, 0) bp, (p_total * coalesce(m.default_share_bp, 0)) / v_tot as fl,
           (p_total * coalesce(m.default_share_bp, 0)) % v_tot as rem, m.joined_at
    from public.space_members m where m.space_id = p_space),
  ranked as (select b.*, row_number() over (order by b.rem desc, b.joined_at, b.id) rk, p_total - sum(b.fl) over () as lft from base b)
  select r.id, r.bp, r.fl + case when r.rk <= r.lft then 1 else 0 end from ranked r;
end; $$;
revoke all on function public._default_split(uuid, bigint) from public, anon, authenticated;

-- ───────── RPC ─────────
create or replace function public.save_plan(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_space uuid := (p ->> 'space_id')::uuid; v_month date := (p ->> 'month')::date; v_id uuid; v_status public.plan_status; v_pct integer; r record;
begin
  if not public.is_full_member(v_space) then raise exception 'No autorizado'; end if;
  if extract(day from v_month) <> 1 then raise exception 'Mes no válido'; end if;
  select id, status into v_id, v_status from public.monthly_plans where space_id = v_space and month = v_month for update;
  if v_id is null then
    insert into public.monthly_plans (space_id, month, notes) values (v_space, v_month, left(p ->> 'notes', 500)) returning id into v_id;
  else
    if v_status = 'closed' then raise exception 'El mes está cerrado: reábrelo para editarlo'; end if;
    update public.monthly_plans set notes = left(p ->> 'notes', 500) where id = v_id;
    delete from public.plan_incomes where plan_id = v_id;
    delete from public.plan_allocations where plan_id = v_id;
  end if;
  for r in select (e ->> 'member_id')::uuid mid, (e ->> 'expected_cents')::bigint amt from jsonb_array_elements(coalesce(p -> 'incomes', '[]'::jsonb)) e loop
    if not exists (select 1 from public.space_members where id = r.mid and space_id = v_space) then raise exception 'Miembro ajeno al espacio'; end if;
    insert into public.plan_incomes (plan_id, member_id, expected_cents) values (v_id, r.mid, r.amt);
  end loop;
  select coalesce(sum((e ->> 'value')::bigint) filter (where e ->> 'mode' = 'percent'), 0) into v_pct from jsonb_array_elements(coalesce(p -> 'allocations', '[]'::jsonb)) e;
  if v_pct > 10000 then raise exception 'Los porcentajes de los fondos superan el 100 %%'; end if;
  for r in select (e ->> 'fund_id')::uuid fid, (e ->> 'mode')::public.alloc_mode md, (e ->> 'value')::bigint val, (e ->> 'planned_cents')::bigint pl
           from jsonb_array_elements(coalesce(p -> 'allocations', '[]'::jsonb)) e loop
    if not exists (select 1 from public.funds where id = r.fid and space_id = v_space) then raise exception 'Fondo ajeno al espacio'; end if;
    insert into public.plan_allocations (plan_id, fund_id, mode, value, planned_cents) values (v_id, r.fid, r.md, r.val, r.pl);
  end loop;
  return v_id;
end; $$;

create or replace function public.copy_plan(p_space uuid, p_from date, p_to date)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare src public.monthly_plans; v_id uuid;
begin
  if not public.is_full_member(p_space) then raise exception 'No autorizado'; end if;
  if extract(day from p_to) <> 1 then raise exception 'Mes no válido'; end if;
  select * into src from public.monthly_plans where space_id = p_space and month = p_from;
  if not found then raise exception 'No hay plan en el mes anterior'; end if;
  if exists (select 1 from public.monthly_plans where space_id = p_space and month = p_to) then raise exception 'Ese mes ya tiene plan'; end if;
  insert into public.monthly_plans (space_id, month, notes) values (p_space, p_to, src.notes) returning id into v_id;
  insert into public.plan_incomes select v_id, member_id, expected_cents from public.plan_incomes where plan_id = src.id;
  insert into public.plan_allocations select v_id, fund_id, mode, value, planned_cents from public.plan_allocations where plan_id = src.id;
  return v_id;
end; $$;

create or replace function public.save_contribution_rule(p_space uuid, p_mode public.contrib_mode, p_target bigint, p_values jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_owner(p_space) then raise exception 'No autorizado'; end if;
  if (select kind from public.spaces where id = p_space) <> 'household' then raise exception 'Solo los hogares tienen bote común'; end if;
  insert into public.contribution_rules (space_id, mode, monthly_target_cents, values) values (p_space, p_mode, p_target, coalesce(p_values, '{}'))
  on conflict (space_id) do update set mode = excluded.mode, monthly_target_cents = excluded.monthly_target_cents, values = excluded.values;
end; $$;

create or replace function public.save_contributions(p_space uuid, p_month date, p_lines jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record;
begin
  if not public.is_owner(p_space) then raise exception 'No autorizado'; end if;
  if extract(day from p_month) <> 1 then raise exception 'Mes no válido'; end if;
  for r in select (e ->> 'member_id')::uuid mid, (e ->> 'expected_cents')::bigint amt from jsonb_array_elements(p_lines) e loop
    if not exists (select 1 from public.space_members where id = r.mid and space_id = p_space) then raise exception 'Miembro ajeno al espacio'; end if;
    insert into public.contributions (space_id, member_id, month, expected_cents) values (p_space, r.mid, p_month, r.amt)
    on conflict (space_id, member_id, month) do update set expected_cents = excluded.expected_cents;
  end loop;
end; $$;

-- Marcar la aportación como hecha: sube el bote y cuenta como gasto en el plan personal de quien aporta
create or replace function public.mark_contribution_paid(p_id uuid, p_paid bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.contributions; m public.space_members; sp public.spaces; v_ps uuid; v_pm uuid; v_cat uuid; v_exp uuid; v_pcur char(3);
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
    if v_ps is not null and v_pcur = sp.base_currency then
      select id into v_pm from public.space_members where space_id = v_ps and user_id = m.user_id;
      select cat.id into v_cat from public.categories cat join public.funds f on f.id = cat.fund_id
        where cat.space_id = v_ps and f.kind = 'contribution' limit 1;
      insert into public.expenses (space_id, client_id, description, category_id, spent_at, amount_cents, currency, amount_base_cents,
                                   paid_from, split_mode, created_by_member)
      values (v_ps, gen_random_uuid(), left('Aportación a ' || sp.name, 120), v_cat, current_date, p_paid, v_pcur, p_paid, 'member', 'equal', v_pm)
      returning id into v_exp;
      insert into public.expense_payers values (v_exp, v_pm, p_paid);
      insert into public.expense_splits values (v_exp, v_pm, 10000, p_paid);
    end if;
  end if;
  update public.contributions set paid_cents = p_paid, paid_at = case when p_paid > 0 then current_date else null end, personal_expense_id = v_exp where id = p_id;
end; $$;

create or replace function public.save_recurring(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_space uuid := (p ->> 'space_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; v_me public.space_members; v_paid text := coalesce(p ->> 'paid_from', 'member');
  v_payer uuid := nullif(p ->> 'payer_member_id', '')::uuid; v_cat uuid := nullif(p ->> 'category_id', '')::uuid; v_fund uuid;
begin
  select * into v_me from public.space_members where space_id = v_space and user_id = auth.uid() and role in ('owner', 'member');
  if not found then raise exception 'No autorizado'; end if;
  if v_paid = 'member' then
    v_payer := coalesce(v_payer, v_me.id);
    if not exists (select 1 from public.space_members where id = v_payer and space_id = v_space) then raise exception 'Pagador no válido'; end if;
  else
    if (select kind from public.spaces where id = v_space) <> 'household' then raise exception 'Pago desde el bote no permitido'; end if;
    v_payer := null;
  end if;
  if v_cat is not null then
    select fund_id into v_fund from public.categories where id = v_cat and space_id = v_space;
    if v_fund is null then raise exception 'Categoría ajena al espacio'; end if;
  end if;
  if v_id is null then
    insert into public.recurring_expenses (space_id, fund_id, category_id, description, amount_cents, frequency, day, next_run, payer_member_id, paid_from, detected)
    values (v_space, v_fund, v_cat, btrim(p ->> 'description'), (p ->> 'amount_cents')::bigint, coalesce(p ->> 'frequency', 'monthly')::public.recur_freq,
            (p ->> 'day')::int, (p ->> 'next_run')::date, v_payer, v_paid, coalesce((p ->> 'detected')::boolean, false))
    returning id into v_id;
  else
    update public.recurring_expenses set fund_id = v_fund, category_id = v_cat, description = btrim(p ->> 'description'), amount_cents = (p ->> 'amount_cents')::bigint,
      frequency = coalesce(p ->> 'frequency', 'monthly')::public.recur_freq, day = (p ->> 'day')::int, next_run = (p ->> 'next_run')::date,
      payer_member_id = v_payer, paid_from = v_paid, active = coalesce((p ->> 'active')::boolean, true)
    where id = v_id and space_id = v_space;
    if not found then raise exception 'Gasto fijo no encontrado'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.delete_recurring(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare s uuid;
begin
  select space_id into s from public.recurring_expenses where id = p_id;
  if s is null then return; end if;
  if not public.is_full_member(s) then raise exception 'No autorizado'; end if;
  delete from public.recurring_expenses where id = p_id;
end; $$;

-- Genera los gastos fijos que tocan (cron diario). Solo service_role / pg_cron.
create or replace function public.process_recurring()
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.recurring_expenses; n integer := 0; v_run date; v_exp uuid; v_cur char(3); v_creator uuid; i integer; s record;
begin
  for r in select * from public.recurring_expenses where active and next_run <= current_date for update skip locked loop
    select base_currency into v_cur from public.spaces where id = r.space_id and archived_at is null;
    continue when v_cur is null;
    v_creator := coalesce(r.payer_member_id, (select id from public.space_members where space_id = r.space_id and role = 'owner' limit 1));
    v_run := r.next_run; i := 0;
    while v_run <= current_date and i < 12 loop
      begin
      insert into public.expenses (space_id, client_id, description, category_id, spent_at, amount_cents, currency, amount_base_cents, paid_from, split_mode, recurring_id, created_by_member)
      values (r.space_id, gen_random_uuid(), r.description, r.category_id, v_run, r.amount_cents, v_cur, r.amount_cents, r.paid_from, 'default', r.id, v_creator)
      returning id into v_exp;
      if r.paid_from = 'member' then insert into public.expense_payers values (v_exp, r.payer_member_id, r.amount_cents); end if;
      for s in select * from public._default_split(r.space_id, r.amount_cents) loop
        insert into public.expense_splits values (v_exp, s.member_id, s.share_bp, s.amount_cents);
      end loop;
        n := n + 1;
      exception when others then null; -- p. ej. mes cerrado: se omite ese cobro y se sigue
      end;
      i := i + 1;
      v_run := case r.frequency when 'weekly' then v_run + 7
                 when 'monthly' then (date_trunc('month', v_run) + interval '1 month')::date + (least(r.day, extract(day from (date_trunc('month', v_run) + interval '2 month - 1 day'))::int) - 1)
                 else (v_run + interval '1 year')::date end;
    end loop;
    update public.recurring_expenses set next_run = v_run where id = r.id;
  end loop;
  return n;
end; $$;
revoke all on function public.process_recurring() from public, anon, authenticated;
grant execute on function public.process_recurring() to service_role;

do $$
declare f text;
begin
  foreach f in array array['save_plan(jsonb)', 'copy_plan(uuid, date, date)', 'save_contribution_rule(uuid, public.contrib_mode, bigint, jsonb)',
    'save_contributions(uuid, date, jsonb)', 'mark_contribution_paid(uuid, bigint)', 'save_recurring(jsonb)', 'delete_recurring(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Cron diario (si pg_cron está disponible; si no, la ruta /api/cron/recurring hace lo mismo)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('fifti-process-recurring', '10 3 * * *', 'select public.process_recurring()');
  end if;
exception when others then null;
end $$;

-- ───────── RLS ─────────
do $$
declare t text;
begin
  foreach t in array array['monthly_plans','plan_incomes','plan_allocations','contribution_rules','contributions','recurring_expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy plans_select on public.monthly_plans for select to authenticated using (public.is_member(space_id));
create policy plan_incomes_select on public.plan_incomes for select to authenticated
  using (exists (select 1 from public.monthly_plans p where p.id = plan_id and public.is_member(p.space_id)));
create policy plan_alloc_select on public.plan_allocations for select to authenticated
  using (exists (select 1 from public.monthly_plans p where p.id = plan_id and public.is_member(p.space_id)));
create policy rules_select on public.contribution_rules for select to authenticated using (public.is_member(space_id));
create policy contributions_select on public.contributions for select to authenticated using (public.is_member(space_id));
create policy recurring_select on public.recurring_expenses for select to authenticated using (public.is_member(space_id));
