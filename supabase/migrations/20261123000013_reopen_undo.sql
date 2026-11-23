-- Reabrir un mes deshace lo que hizo el cierre: el arrastre al mes siguiente y las aportaciones a metas.

alter table public.goal_contributions add column close_plan_id uuid references public.monthly_plans (id) on delete set null;

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
      insert into public.goal_contributions (goal_id, space_id, member_id, amount_cents, source, contributed_at, close_plan_id)
      values (d.gid, p_space, v_me, d.lo, 'month_surplus', (p_month + interval '1 month - 1 day')::date, pl.id);
    end if;
  end loop;
  update public.monthly_plans set status = 'closed', closed_at = now() where id = pl.id;
end; $$;

create or replace function public.reopen_plan(p_space uuid, p_month date)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare pl public.monthly_plans; d record; v_next uuid; v_next_month date := (p_month + interval '1 month')::date;
begin
  if not public.is_owner(p_space) and not (public.is_full_member(p_space) and (select kind from public.spaces where id = p_space) = 'personal') then
    raise exception 'No autorizado';
  end if;
  select * into pl from public.monthly_plans where space_id = p_space and month = p_month and status = 'closed' for update;
  if not found then raise exception 'Ese mes no está cerrado'; end if;
  -- 1) Quitar el arrastre que el cierre añadió al mes siguiente
  select id into v_next from public.monthly_plans where space_id = p_space and month = v_next_month;
  if v_next is not null then
    for d in select fund_id, leftover_cents from public.plan_close_decisions where plan_id = pl.id and action = 'rollover' and leftover_cents > 0 loop
      update public.plan_allocations set carry_cents = greatest(0, carry_cents - d.leftover_cents) where plan_id = v_next and fund_id = d.fund_id;
      -- si la fila solo existía por el arrastre, se elimina
      delete from public.plan_allocations where plan_id = v_next and fund_id = d.fund_id and carry_cents = 0 and planned_cents = 0 and value = 0;
    end loop;
    -- si el plan siguiente lo creó el cierre y sigue vacío, se elimina
    delete from public.monthly_plans mp where mp.id = v_next and mp.status = 'active' and mp.notes is null
      and not exists (select 1 from public.plan_allocations where plan_id = mp.id) and not exists (select 1 from public.plan_incomes where plan_id = mp.id);
  end if;
  -- 2) Quitar lo que fue a metas
  delete from public.goal_contributions where close_plan_id = pl.id and source = 'month_surplus';
  delete from public.plan_close_decisions where plan_id = pl.id;
  update public.monthly_plans set status = 'active', closed_at = null where id = pl.id;
end; $$;
