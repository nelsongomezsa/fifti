-- Vaciar un espacio y aportar al hogar.

-- ───────── Vaciar espacio ─────────
-- Borra gastos, ingresos, plan del mes, gastos fijos, metas, aportaciones, liquidaciones, lista de la compra
-- y (en el espacio Personal) los préstamos de quien lo vacía. Conserva la cuenta, el resto de espacios, las
-- partidas, categorías y reglas, y el historial (solo inserción).
-- Quién puede: solo quien creó el espacio (en Personal, su dueño).
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

  -- Primero los planes: así ningún mes cerrado bloquea el borrado de sus movimientos
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
  if sp.kind = 'personal' then delete from public.loans where user_id = uid; end if;

  return jsonb_build_object('name', sp.name, 'kind', sp.kind, 'others', v_users);
end; $$;
revoke all on function public.clear_space(uuid) from public, anon;
grant execute on function public.clear_space(uuid) to authenticated;

-- ───────── Aportar al hogar ─────────
-- Suma `p_amount` a lo que la persona ya ha aportado este mes al hogar. En Personal se ve como una salida
-- («Aportación a …», partida Aportación al hogar) y en el hogar como lo aportado por esa persona.
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
  perform public.mark_contribution_paid(c.id, c.paid_cents + p_amount);
  return c.id;
end; $$;
revoke all on function public.contribute_household(uuid, bigint) from public, anon;
grant execute on function public.contribute_household(uuid, bigint) to authenticated;
