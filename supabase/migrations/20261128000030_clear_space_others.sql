-- Vaciar un espacio no toca las cuentas propias de otros miembros: solo las de quien vacía y las comunes del espacio.
-- Misma firma que antes, así que la versión publicada de la app sigue funcionando.
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
