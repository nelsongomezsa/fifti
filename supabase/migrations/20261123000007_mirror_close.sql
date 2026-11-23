-- Fase 7: reflejo grupo -> personal, cierre de mes (solo lectura + sobrante) y series mensuales.

-- ───────── Reflejo de "tu parte" en el plan personal ─────────
create table public.mirror_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  enabled boolean not null default true,
  fund_id uuid references public.funds (id) on delete set null,
  primary key (user_id, space_id)
);
create table public.personal_mirror (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_expense_id uuid not null references public.expenses (id) on delete cascade,
  personal_space_id uuid not null references public.spaces (id) on delete cascade,
  fund_id uuid not null references public.funds (id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  spent_at date not null,
  label text not null check (char_length(label) <= 60),
  enabled boolean not null default true,
  unique (user_id, source_expense_id)
);
create index personal_mirror_user_month on public.personal_mirror (user_id, spent_at);

create or replace function public._mirror_target(p_user uuid, p_space uuid, p_category uuid)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_pref public.mirror_prefs; v_personal uuid; v_kind public.space_kind; v_fkind public.fund_kind; v_want public.fund_kind; v_fund uuid;
begin
  select * into v_pref from public.mirror_prefs where user_id = p_user and space_id = p_space;
  if found and not v_pref.enabled then return null; end if;
  select id into v_personal from public.spaces where created_by = p_user and kind = 'personal';
  if v_personal is null then return null; end if;
  if found and v_pref.fund_id is not null and exists (select 1 from public.funds where id = v_pref.fund_id and space_id = v_personal) then
    return v_pref.fund_id;
  end if;
  select kind into v_kind from public.spaces where id = p_space;
  if v_kind = 'group' then v_want := 'leisure';
  else
    select f.kind into v_fkind from public.categories c join public.funds f on f.id = c.fund_id where c.id = p_category;
    v_want := case when v_fkind = 'fixed' then 'fixed' else 'variable' end;
  end if;
  select id into v_fund from public.funds where space_id = v_personal and kind = v_want order by position limit 1;
  return v_fund;
end; $$;
revoke all on function public._mirror_target(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._mirror_apply(p_expense uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare e public.expenses; m public.space_members; s public.spaces; sp_amount bigint; v_personal uuid; v_fund uuid; v_pcur char(3);
begin
  select * into e from public.expenses where id = p_expense;
  select * into m from public.space_members where id = p_member;
  if e.id is null or m.user_id is null then return; end if;
  select * into s from public.spaces where id = e.space_id;
  if s.kind = 'personal' then return; end if;
  select amount_cents into sp_amount from public.expense_splits where expense_id = p_expense and member_id = p_member;
  select id, base_currency into v_personal, v_pcur from public.spaces where created_by = m.user_id and kind = 'personal';
  v_fund := case when e.paid_from = 'member' and sp_amount is not null and v_personal is not null and v_pcur = s.base_currency
                 then public._mirror_target(m.user_id, s.id, e.category_id) else null end;
  if v_fund is null then
    delete from public.personal_mirror where user_id = m.user_id and source_expense_id = p_expense;
  else
    insert into public.personal_mirror (user_id, source_expense_id, personal_space_id, fund_id, amount_cents, spent_at, label)
    values (m.user_id, p_expense, v_personal, v_fund, sp_amount, e.spent_at, left(s.name, 60))
    on conflict (user_id, source_expense_id) do update set fund_id = excluded.fund_id, amount_cents = excluded.amount_cents, spent_at = excluded.spent_at, label = excluded.label;
  end if;
end; $$;
revoke all on function public._mirror_apply(uuid, uuid) from public, anon, authenticated;

create or replace function public.mirror_on_split()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.personal_mirror pm using public.space_members m
      where m.id = old.member_id and pm.user_id = m.user_id and pm.source_expense_id = old.expense_id;
  else
    perform public._mirror_apply(new.expense_id, new.member_id);
  end if;
  return null;
end; $$;
create trigger mirror_split after insert or update or delete on public.expense_splits for each row execute function public.mirror_on_split();

-- Cambiar la preferencia de un grupo reaplica el reflejo de sus gastos
create or replace function public.set_mirror_pref(p_space uuid, p_enabled boolean, p_fund uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; v_me uuid;
begin
  if auth.uid() is null or public.is_guest_user() or not public.is_member(p_space) then raise exception 'No autorizado'; end if;
  if (select kind from public.spaces where id = p_space) = 'personal' then raise exception 'No aplica a la burbuja personal'; end if;
  if p_fund is not null and not exists (select 1 from public.funds f join public.spaces s on s.id = f.space_id where f.id = p_fund and s.created_by = auth.uid() and s.kind = 'personal') then
    raise exception 'Fondo no válido';
  end if;
  insert into public.mirror_prefs (user_id, space_id, enabled, fund_id) values (auth.uid(), p_space, p_enabled, p_fund)
  on conflict (user_id, space_id) do update set enabled = excluded.enabled, fund_id = excluded.fund_id;
  select id into v_me from public.space_members where space_id = p_space and user_id = auth.uid();
  for r in select expense_id from public.expense_splits where member_id = v_me loop
    perform public._mirror_apply(r.expense_id, v_me);
  end loop;
end; $$;

-- ───────── Cierre de mes ─────────
alter table public.plan_allocations add column carry_cents bigint not null default 0 check (carry_cents >= 0 and carry_cents <= 100000000000);
create type public.close_action as enum ('rollover', 'goal', 'free');
create table public.plan_close_decisions (
  plan_id uuid not null references public.monthly_plans (id) on delete cascade,
  fund_id uuid not null references public.funds (id) on delete cascade,
  action public.close_action not null,
  goal_id uuid,
  leftover_cents bigint not null,
  primary key (plan_id, fund_id)
);

-- Un mes cerrado es de solo lectura (gastos e ingresos). Los borrados en cascada del espacio no se bloquean.
create or replace function public._month_closed(p_space uuid, p_date date)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.monthly_plans where space_id = p_space and status = 'closed' and month = date_trunc('month', p_date)::date); $$;
revoke all on function public._month_closed(uuid, date) from public, anon, authenticated;

create or replace function public.block_closed_month()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare rec jsonb;
begin
  if pg_trigger_depth() > 1 then
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
create trigger expenses_closed_month before insert or update or delete on public.expenses for each row execute function public.block_closed_month();
create trigger incomes_closed_month before insert or update or delete on public.incomes for each row execute function public.block_closed_month();

create or replace function public.close_plan(p_space uuid, p_month date, p_decisions jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare pl public.monthly_plans; d record; v_next uuid; v_next_month date := (p_month + interval '1 month')::date;
begin
  if not public.is_owner(p_space) and not (public.is_full_member(p_space) and (select kind from public.spaces where id = p_space) = 'personal') then
    raise exception 'No autorizado';
  end if;
  select * into pl from public.monthly_plans where space_id = p_space and month = p_month for update;
  if not found then raise exception 'No hay plan en ese mes'; end if;
  if pl.status = 'closed' then raise exception 'El mes ya está cerrado'; end if;
  delete from public.plan_close_decisions where plan_id = pl.id;
  for d in select (e ->> 'fund_id')::uuid fid, (e ->> 'action')::public.close_action act, nullif(e ->> 'goal_id', '')::uuid gid, (e ->> 'leftover_cents')::bigint lo
           from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) e loop
    if not exists (select 1 from public.funds where id = d.fid and space_id = p_space) then raise exception 'Fondo ajeno al espacio'; end if;
    if d.act = 'goal' then raise exception 'Las metas se activan en la fase de ahorro'; end if;
    insert into public.plan_close_decisions values (pl.id, d.fid, d.act, d.gid, d.lo);
    if d.act = 'rollover' and d.lo > 0 then
      select id into v_next from public.monthly_plans where space_id = p_space and month = v_next_month;
      if v_next is null then insert into public.monthly_plans (space_id, month) values (p_space, v_next_month) returning id into v_next; end if;
      insert into public.plan_allocations (plan_id, fund_id, mode, value, planned_cents, carry_cents) values (v_next, d.fid, 'amount', 0, 0, d.lo)
      on conflict (plan_id, fund_id) do update set carry_cents = public.plan_allocations.carry_cents + excluded.carry_cents;
    end if;
  end loop;
  update public.monthly_plans set status = 'closed', closed_at = now() where id = pl.id;
end; $$;

create or replace function public.reopen_plan(p_space uuid, p_month date)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_owner(p_space) then raise exception 'No autorizado'; end if;
  update public.monthly_plans set status = 'active', closed_at = null where space_id = p_space and month = p_month and status = 'closed';
  if not found then raise exception 'Ese mes no está cerrado'; end if;
end; $$;

-- ───────── Series mensuales (respetan RLS) ─────────
create or replace function public.monthly_spend(p_space uuid, p_from date)
returns table (month date, total_cents bigint) language sql stable security invoker set search_path = public
as $$
  select date_trunc('month', spent_at)::date, sum(amount_base_cents)::bigint from public.expenses
  where space_id = p_space and spent_at >= p_from group by 1 order by 1;
$$;
create or replace function public.monthly_income(p_space uuid, p_from date)
returns table (month date, total_cents bigint) language sql stable security invoker set search_path = public
as $$
  select date_trunc('month', received_at)::date, sum(amount_cents)::bigint from public.incomes
  where space_id = p_space and received_at >= p_from group by 1 order by 1;
$$;
create or replace function public.monthly_mirror(p_from date)
returns table (month date, total_cents bigint) language sql stable security invoker set search_path = public
as $$
  select date_trunc('month', spent_at)::date, sum(amount_cents)::bigint from public.personal_mirror
  where user_id = auth.uid() and enabled and spent_at >= p_from group by 1 order by 1;
$$;

do $$
declare f text;
begin
  foreach f in array array['set_mirror_pref(uuid, boolean, uuid)', 'close_plan(uuid, date, jsonb)', 'reopen_plan(uuid, date)',
    'monthly_spend(uuid, date)', 'monthly_income(uuid, date)', 'monthly_mirror(date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────── RLS ─────────
alter table public.mirror_prefs enable row level security;
alter table public.mirror_prefs force row level security;
alter table public.personal_mirror enable row level security;
alter table public.personal_mirror force row level security;
alter table public.plan_close_decisions enable row level security;
alter table public.plan_close_decisions force row level security;
revoke all on public.mirror_prefs, public.personal_mirror, public.plan_close_decisions from anon, authenticated;
grant select on public.mirror_prefs, public.personal_mirror, public.plan_close_decisions to authenticated;
-- Solo el propio usuario ve su reflejo y sus preferencias; nadie escribe directamente (RPC / triggers)
create policy mirror_prefs_select on public.mirror_prefs for select to authenticated using (user_id = auth.uid());
create policy personal_mirror_select on public.personal_mirror for select to authenticated using (user_id = auth.uid());
create policy close_decisions_select on public.plan_close_decisions for select to authenticated
  using (exists (select 1 from public.monthly_plans p where p.id = plan_id and public.is_member(p.space_id)));
