-- Fase 8: metas de ahorro (simples, grandes con hitos, retos), reglas automáticas y sobrante del cierre.

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  target_cents bigint not null check (target_cents > 0 and target_cents <= 100000000000),
  deadline date,
  emoji text check (emoji is null or char_length(emoji) <= 8),
  kind text not null default 'simple' check (kind in ('simple', 'big_event', 'challenge')),
  created_at timestamptz not null default now(),
  unique (id, space_id)
);
create table public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  space_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  due_on date,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  paid boolean not null default false,
  foreign key (goal_id, space_id) references public.savings_goals (id, space_id) on delete cascade
);
create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  space_id uuid not null,
  member_id uuid not null references public.space_members (id),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  source text not null check (source in ('manual', 'roundup', 'income_rule', 'month_surplus', 'challenge')),
  source_expense_id uuid references public.expenses (id) on delete cascade,
  source_income_id uuid references public.incomes (id) on delete cascade,
  contributed_at date not null default current_date,
  created_at timestamptz not null default now(),
  foreign key (goal_id, space_id) references public.savings_goals (id, space_id) on delete cascade
);
create index goal_contributions_goal_idx on public.goal_contributions (goal_id);
create table public.saving_rules (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null,
  goal_id uuid not null,
  kind text not null check (kind in ('roundup', 'percent_of_income', 'weekly_challenge')),
  value bigint not null check (value > 0 and value <= 100000000000),
  active boolean not null default true,
  foreign key (goal_id, space_id) references public.savings_goals (id, space_id) on delete cascade,
  check (kind <> 'percent_of_income' or value <= 10000)
);

-- ───────── RPC ─────────
create or replace function public.add_goal_contribution(p_goal uuid, p_amount bigint, p_source text, p_date date)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare g public.savings_goals; m public.space_members; v_id uuid;
begin
  select * into g from public.savings_goals where id = p_goal;
  if not found then raise exception 'Meta no encontrada'; end if;
  select * into m from public.space_members where space_id = g.space_id and user_id = auth.uid() and role in ('owner', 'member');
  if not found then raise exception 'No autorizado'; end if;
  if p_source not in ('manual', 'challenge') then raise exception 'Origen no válido'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Importe no válido'; end if;
  insert into public.goal_contributions (goal_id, space_id, member_id, amount_cents, source, contributed_at)
  values (p_goal, g.space_id, m.id, p_amount, p_source, coalesce(p_date, current_date)) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.delete_goal_contribution(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.goal_contributions;
begin
  select * into c from public.goal_contributions where id = p_id;
  if not found then return; end if;
  if c.source not in ('manual', 'challenge') then raise exception 'Las aportaciones automáticas no se borran a mano'; end if;
  if not exists (select 1 from public.space_members where id = c.member_id and user_id = auth.uid()) and not public.is_owner(c.space_id) then raise exception 'No autorizado'; end if;
  delete from public.goal_contributions where id = p_id;
end; $$;

-- ───────── Reglas automáticas ─────────
create or replace function public.apply_roundup()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; v_amt bigint;
begin
  if (select kind from public.spaces where id = new.space_id) <> 'personal' then return null; end if;
  delete from public.goal_contributions where source_expense_id = new.id and source = 'roundup';
  for r in select goal_id, value from public.saving_rules where space_id = new.space_id and kind = 'roundup' and active loop
    v_amt := case when new.amount_cents % r.value = 0 then 0 else r.value - (new.amount_cents % r.value) end;
    if v_amt > 0 then
      insert into public.goal_contributions (goal_id, space_id, member_id, amount_cents, source, source_expense_id, contributed_at)
      values (r.goal_id, new.space_id, new.created_by_member, v_amt, 'roundup', new.id, new.spent_at);
    end if;
  end loop;
  return null;
end; $$;
create trigger expenses_roundup after insert or update of amount_cents on public.expenses for each row execute function public.apply_roundup();

create or replace function public.apply_income_rules()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; v_amt bigint;
begin
  for r in select goal_id, value from public.saving_rules where space_id = new.space_id and kind = 'percent_of_income' and active loop
    v_amt := round(new.amount_cents * r.value / 10000.0);
    if v_amt > 0 then
      insert into public.goal_contributions (goal_id, space_id, member_id, amount_cents, source, source_income_id, contributed_at)
      values (r.goal_id, new.space_id, new.member_id, v_amt, 'income_rule', new.id, new.received_at);
    end if;
  end loop;
  return null;
end; $$;
create trigger incomes_rules after insert on public.incomes for each row execute function public.apply_income_rules();

-- El sobrante del cierre de mes puede ir a una meta (sustituye a la versión de la fase 7)
create or replace function public.close_plan(p_space uuid, p_month date, p_decisions jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare pl public.monthly_plans; d record; v_next uuid; v_next_month date := (p_month + interval '1 month')::date; v_me uuid;
begin
  if not public.is_owner(p_space) and not (public.is_full_member(p_space) and (select kind from public.spaces where id = p_space) = 'personal') then
    raise exception 'No autorizado';
  end if;
  select * into pl from public.monthly_plans where space_id = p_space and month = p_month for update;
  if not found then raise exception 'No hay plan en ese mes'; end if;
  if pl.status = 'closed' then raise exception 'El mes ya está cerrado'; end if;
  select id into v_me from public.space_members where space_id = p_space and user_id = auth.uid();
  delete from public.plan_close_decisions where plan_id = pl.id;
  for d in select (e ->> 'fund_id')::uuid fid, (e ->> 'action')::public.close_action act, nullif(e ->> 'goal_id', '')::uuid gid, (e ->> 'leftover_cents')::bigint lo
           from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) e loop
    if not exists (select 1 from public.funds where id = d.fid and space_id = p_space) then raise exception 'Fondo ajeno al espacio'; end if;
    if d.act = 'goal' and (d.gid is null or not exists (select 1 from public.savings_goals where id = d.gid and space_id = p_space)) then
      raise exception 'Meta no válida';
    end if;
    insert into public.plan_close_decisions values (pl.id, d.fid, d.act, d.gid, d.lo);
    if d.act = 'rollover' and d.lo > 0 then
      select id into v_next from public.monthly_plans where space_id = p_space and month = v_next_month;
      if v_next is null then insert into public.monthly_plans (space_id, month) values (p_space, v_next_month) returning id into v_next; end if;
      insert into public.plan_allocations (plan_id, fund_id, mode, value, planned_cents, carry_cents) values (v_next, d.fid, 'amount', 0, 0, d.lo)
      on conflict (plan_id, fund_id) do update set carry_cents = public.plan_allocations.carry_cents + excluded.carry_cents;
    elsif d.act = 'goal' and d.lo > 0 then
      insert into public.goal_contributions (goal_id, space_id, member_id, amount_cents, source, contributed_at)
      values (d.gid, p_space, v_me, d.lo, 'month_surplus', (p_month + interval '1 month - 1 day')::date);
    end if;
  end loop;
  update public.monthly_plans set status = 'closed', closed_at = now() where id = pl.id;
end; $$;

do $$
declare f text;
begin
  foreach f in array array['add_goal_contribution(uuid, bigint, text, date)', 'delete_goal_contribution(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────── RLS ─────────
do $$
declare t text;
begin
  foreach t in array array['savings_goals', 'goal_milestones', 'goal_contributions', 'saving_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(space_id))', t || '_select', t);
  end loop;
end $$;
-- Metas, hitos y reglas: los miembros completos las gestionan directamente (las FK compuestas impiden mezclar espacios)
create policy goals_write on public.savings_goals for all to authenticated using (public.is_full_member(space_id)) with check (public.is_full_member(space_id));
create policy milestones_write on public.goal_milestones for all to authenticated using (public.is_full_member(space_id)) with check (public.is_full_member(space_id));
create policy rules_write on public.saving_rules for all to authenticated using (public.is_full_member(space_id)) with check (public.is_full_member(space_id));
grant insert, update, delete on public.savings_goals, public.goal_milestones, public.saving_rules to authenticated;
-- goal_contributions: solo por RPC (manual/reto) o por triggers (reglas, cierre)
