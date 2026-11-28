-- Borrar cuentas bancarias (una a una o al vaciar un espacio). Compatible con la versión anterior de la app:
-- se puede aplicar antes de desplegar.

-- Quitar la cuenta de un movimiento no cambia el movimiento: también se permite en meses cerrados
create or replace function public.block_closed_month()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare rec jsonb;
begin
  if pg_trigger_depth() > 1 or (tg_op = 'UPDATE' and (coalesce(current_setting('fifti.currency_change', true), '') = '1'
                                                      or coalesce(current_setting('fifti.account_delete', true), '') = '1')) then
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

-- Borra una cuenta (ya comprobada) con sus traspasos y ajustes; los movimientos y las partidas se quedan sin cuenta
create or replace function public._delete_account(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.accounts;
begin
  select * into a from public.accounts where id = p_id for update;
  if not found then return; end if;
  perform set_config('fifti.account_delete', '1', true);
  update public.expenses set account_id = null where account_id = p_id;
  update public.incomes set account_id = null where account_id = p_id;
  delete from public.accounts where id = p_id; -- traspasos y ajustes caen en cascada; fijos y fondos quedan sin cuenta
  perform set_config('fifti.account_delete', '', true);
  -- Si era la cuenta por defecto, lo pasa a ser la más antigua que quede de la misma persona en ese espacio
  if a.is_default then
    update public.accounts set is_default = true where id = (
      select id from public.accounts where owner_user_id = a.owner_user_id and space_id = a.space_id and archived_at is null
      order by created_at, id limit 1);
  end if;
end; $$;
revoke all on function public._delete_account(uuid) from public, anon, authenticated;

create or replace function public.delete_account(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); a public.accounts;
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  select * into a from public.accounts where id = p_id and owner_user_id = uid;
  if not found then raise exception 'No autorizado'; end if;
  if not public.rate_limit_hit('delete-account:' || uid::text, 60, 3600) then raise exception 'Demasiados intentos. Espera un rato.'; end if;
  perform public._delete_account(p_id);
  -- Sin nombre ni banco. Las cuentas propias de un hogar son privadas: su registro no se enseña a los demás miembros
  insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
  select case when a.kind = 'shared' or s.kind = 'personal' then a.space_id end, uid, 'accounts', p_id, 'delete',
         jsonb_build_object('kind', a.kind, 'currency', a.currency, 'archived', a.archived_at is not null)
  from public.spaces s where s.id = a.space_id;
end; $$;
revoke all on function public.delete_account(uuid) from public, anon;
grant execute on function public.delete_account(uuid) to authenticated;

-- Vaciar un espacio: opcionalmente, también las cuentas de quien lo vacía (las de otras personas no se tocan).
-- Por defecto NO: la versión anterior de la app llama sin la casilla y no debe borrar cuentas sin avisar.
drop function public.clear_space(uuid);
create function public.clear_space(p_space uuid, p_delete_accounts boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); sp public.spaces; v_users jsonb; v_account uuid; v_accounts integer := 0;
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
  return jsonb_build_object('name', sp.name, 'kind', sp.kind, 'others', v_users);
end; $$;
revoke all on function public.clear_space(uuid, boolean) from public, anon;
grant execute on function public.clear_space(uuid, boolean) to authenticated;
