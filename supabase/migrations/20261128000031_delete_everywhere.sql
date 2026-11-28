-- Borrar igual en toda la app: permisos en la base, rastro en audit_log y borrados transaccionales.
-- Las funciones que ya existían conservan su firma y los permisos directos siguen igual, así que la versión publicada sigue funcionando.

alter table public.categories add column if not exists hidden boolean not null default false;
alter table public.profiles add column if not exists swipe_hint_at timestamptz;

create or replace function public.dismiss_swipe_hint()
returns void language sql security definer set search_path = public, pg_temp
as $$ update public.profiles set swipe_hint_at = coalesce(swipe_hint_at, now()) where id = auth.uid(); $$;

-- Reasignar la categoría de movimientos de meses cerrados al borrarla no cambia ningún importe
create or replace function public.block_closed_month()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare rec jsonb;
begin
  if pg_trigger_depth() > 1 or (tg_op = 'UPDATE' and (coalesce(current_setting('fifti.currency_change', true), '') = '1'
                                                      or coalesce(current_setting('fifti.account_delete', true), '') = '1'
                                                      or coalesce(current_setting('fifti.reassign', true), '') = '1')) then
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

-- Un gasto privado solo lo borra quien lo apuntó
create or replace function public.delete_expense(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare e public.expenses; me public.space_members;
begin
  select * into e from public.expenses where id = p_id;
  if not found then return; end if;
  select * into me from public.space_members where space_id = e.space_id and user_id = auth.uid();
  if not found then raise exception 'No autorizado'; end if;
  if (me.role = 'guest' or e.is_private) and e.created_by_member is distinct from me.id then raise exception 'No autorizado'; end if;
  delete from public.expenses where id = p_id;
end; $$;

-- Una liquidación la borra quien la registró (si esa persona ya no existe, quien administra el espacio)
create or replace function public.delete_settlement(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.settlements;
begin
  select * into s from public.settlements where id = p_id;
  if not found then return; end if;
  if s.offset_id is not null then raise exception 'Una compensación no se puede borrar'; end if;
  if not public.is_member(s.space_id) or not (s.created_by = auth.uid() or (s.created_by is null and public.is_owner(s.space_id))) then
    raise exception 'No autorizado';
  end if;
  delete from public.settlements where id = p_id;
end; $$;

/* Borra un elemento comprobando el permiso y dejando constancia. Si ya no existe, no hace nada.
   El rastro de lo privado va sin espacio (nadie más lo ve) y nunca guarda textos ni importes. */
create or replace function public.delete_item(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); v_space uuid; v_table text; v_n integer;
begin
  if uid is null then raise exception 'No autorizado'; end if;

  -- Estas tienen su función y su disparador de auditoría
  if p_kind = 'expense' then perform public.delete_expense(p_id); return;
  elsif p_kind = 'income' then perform public.delete_income(p_id); return;
  elsif p_kind = 'settlement' then perform public.delete_settlement(p_id); return;
  end if;

  if p_kind = 'recurring' then
    select space_id into v_space from public.recurring_expenses where id = p_id;
    if not found then return; end if;
    perform public.delete_recurring(p_id);
    v_table := 'recurring_expenses';
  elsif p_kind = 'transfer' then
    if not exists (select 1 from public.account_transfers where id = p_id) then return; end if;
    perform public.delete_transfer(p_id);
    v_table := 'account_transfers';
  elsif p_kind = 'contribution' then
    select space_id into v_space from public.goal_contributions where id = p_id;
    if not found then return; end if;
    if not public.is_member(v_space) then raise exception 'No autorizado'; end if;
    perform public.delete_goal_contribution(p_id);
    v_table := 'goal_contributions';
  elsif p_kind = 'adjustment' then
    -- El ajuste de una cuenta lo borra quien es dueño de la cuenta
    if not exists (select 1 from public.account_adjustments where id = p_id) then return; end if;
    delete from public.account_adjustments j using public.accounts a where j.id = p_id and a.id = j.account_id and a.owner_user_id = uid;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'No autorizado'; end if;
    v_table := 'account_adjustments';
  elsif p_kind = 'goal' then
    select space_id into v_space from public.savings_goals where id = p_id;
    if not found then return; end if;
    if not public.is_full_member(v_space) then raise exception 'No autorizado'; end if;
    delete from public.savings_goals where id = p_id;
    v_table := 'savings_goals';
  elsif p_kind = 'saving_rule' then
    select space_id into v_space from public.saving_rules where id = p_id;
    if not found then return; end if;
    if not public.is_full_member(v_space) then raise exception 'No autorizado'; end if;
    delete from public.saving_rules where id = p_id;
    v_table := 'saving_rules';
  elsif p_kind = 'loan' then
    if not exists (select 1 from public.loans where id = p_id) then return; end if;
    delete from public.loans where id = p_id and user_id = uid;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'No autorizado'; end if;
    v_table := 'loans';
  elsif p_kind = 'repayment' then
    if not exists (select 1 from public.loan_repayments where id = p_id) then return; end if;
    delete from public.loan_repayments where id = p_id and user_id = uid;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'No autorizado'; end if;
    v_table := 'loan_repayments';
  elsif p_kind = 'rule' then
    select space_id into v_space from public.category_rules where id = p_id;
    if not found then return; end if;
    if not public.is_full_member(v_space) then raise exception 'No autorizado'; end if;
    delete from public.category_rules where id = p_id;
    v_table := 'category_rules';
  elsif p_kind = 'shopping_item' then
    select space_id into v_space from public.shopping_items where id = p_id;
    if not found then return; end if;
    if not public.is_full_member(v_space) then raise exception 'No autorizado'; end if;
    delete from public.shopping_items where id = p_id;
    v_table := 'shopping_items';
  elsif p_kind = 'comment' then
    select space_id into v_space from public.expense_comments where id = p_id;
    if not found then return; end if;
    delete from public.expense_comments c using public.space_members m where c.id = p_id and m.id = c.member_id and m.user_id = uid;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'No autorizado'; end if;
    v_table := 'expense_comments';
  elsif p_kind = 'favorite' then
    if not exists (select 1 from public.favorites where id = p_id) then return; end if;
    delete from public.favorites where id = p_id and user_id = uid;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'No autorizado'; end if;
    v_table := 'favorites';
  elsif p_kind = 'tag' then
    select space_id into v_space from public.tags where id = p_id;
    if not found then return; end if;
    if not public.is_full_member(v_space) then raise exception 'No autorizado'; end if;
    if exists (select 1 from public.expense_tags where tag_id = p_id) then raise exception 'Esa etiqueta todavía se usa en algún gasto'; end if;
    delete from public.tags where id = p_id;
    v_table := 'tags';
  else
    raise exception 'No autorizado';
  end if;

  insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
  values (case when p_kind in ('transfer', 'adjustment', 'loan', 'repayment', 'favorite') then null else v_space end,
          uid, v_table, p_id, 'delete', jsonb_build_object('kind', p_kind));
end; $$;

/* Borrar una categoría propia, moviendo antes sus movimientos a otra (o dejándolos sin categoría). */
create or replace function public.delete_category(p_id uuid, p_move_to uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.categories; v_fund uuid;
begin
  select * into c from public.categories where id = p_id;
  if not found then return; end if;
  if auth.uid() is null or not public.is_full_member(c.space_id) then raise exception 'No autorizado'; end if;
  if c.system_key is not null then raise exception 'Las categorías de Fifti no se borran: se pueden ocultar'; end if;
  if p_move_to is not null then
    select fund_id into v_fund from public.categories where id = p_move_to and space_id = c.space_id and id <> p_id;
    if not found then raise exception 'No autorizado'; end if;
  end if;
  perform set_config('fifti.reassign', '1', true);
  update public.expenses set category_id = p_move_to where category_id = p_id;
  update public.expense_private_details d set category_id = p_move_to where d.category_id = p_id;
  update public.recurring_expenses set category_id = p_move_to, fund_id = coalesce(v_fund, fund_id) where category_id = p_id;
  update public.favorites set category_id = p_move_to where category_id = p_id;
  -- Sin destino, las reglas que apuntaban a ella se van con la categoría
  if p_move_to is not null then
    update public.category_rules set category_id = p_move_to, fund_id = v_fund where category_id = p_id;
  end if;
  delete from public.categories where id = p_id;
  perform set_config('fifti.reassign', '', true);
  insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
  values (c.space_id, auth.uid(), 'categories', p_id, 'delete', jsonb_build_object('moved', p_move_to is not null));
end; $$;

create or replace function public.set_category_hidden(p_id uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.categories;
begin
  select * into c from public.categories where id = p_id;
  if not found or auth.uid() is null or not public.is_full_member(c.space_id) then raise exception 'No autorizado'; end if;
  if p_hidden and c.system_key is null then raise exception 'Las categorías propias se borran, no se ocultan'; end if;
  update public.categories set hidden = coalesce(p_hidden, false) where id = p_id;
  insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
  values (c.space_id, auth.uid(), 'categories', p_id, 'update', jsonb_build_object('hidden', coalesce(p_hidden, false)));
end; $$;

/* Borrar una partida propia: sus categorías (con sus movimientos) pasan a otra partida. */
create or replace function public.delete_fund(p_id uuid, p_move_to uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare f public.funds;
begin
  select * into f from public.funds where id = p_id;
  if not found then return; end if;
  if auth.uid() is null or not public.is_full_member(f.space_id) then raise exception 'No autorizado'; end if;
  if f.system_key is not null or f.linked_space_id is not null then raise exception 'Esa partida la usa Fifti y no se puede borrar'; end if;
  if not exists (select 1 from public.funds where id = p_move_to and space_id = f.space_id and id <> p_id) then raise exception 'No autorizado'; end if;
  if exists (select 1 from public.plan_allocations a join public.monthly_plans p on p.id = a.plan_id where a.fund_id = p_id and p.status = 'closed') then
    raise exception 'Esa partida está en un mes cerrado: reábrelo para borrarla';
  end if;
  update public.categories set fund_id = p_move_to where fund_id = p_id;
  update public.recurring_expenses set fund_id = p_move_to where fund_id = p_id;
  update public.category_rules set fund_id = p_move_to where fund_id = p_id;
  update public.mirror_prefs set fund_id = p_move_to where fund_id = p_id;
  update public.personal_mirror set fund_id = p_move_to where fund_id = p_id;
  delete from public.funds where id = p_id;
  insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
  values (f.space_id, auth.uid(), 'funds', p_id, 'delete', '{}'::jsonb);
end; $$;

/* Quitar una etiqueta de un gasto: puede quien puede borrar el gasto. */
create or replace function public.remove_expense_tag(p_expense uuid, p_tag uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare e public.expenses; me public.space_members;
begin
  select * into e from public.expenses where id = p_expense;
  if not found then raise exception 'No autorizado'; end if;
  select * into me from public.space_members where space_id = e.space_id and user_id = auth.uid();
  if not found or ((me.role = 'guest' or e.is_private) and e.created_by_member is distinct from me.id) then raise exception 'No autorizado'; end if;
  delete from public.expense_tags where expense_id = p_expense and tag_id = p_tag;
  if found then
    insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
    values (e.space_id, auth.uid(), 'expense_tags', p_expense, 'delete', '{}'::jsonb);
  end if;
end; $$;

/* Borrar un espacio entero (menos el Personal): solo quien lo creó. Devuelve a quién avisar. */
create or replace function public.delete_space(p_space uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); sp public.spaces; v_users jsonb; v_account uuid;
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  select * into sp from public.spaces where id = p_space for update;
  if not found or sp.kind = 'personal' or sp.created_by is distinct from uid or not public.is_owner(p_space) then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(m.user_id), '[]'::jsonb) into v_users
    from public.space_members m where m.space_id = p_space and m.user_id is not null and m.user_id <> uid;
  -- Las compensaciones a medias que pasan por este espacio dejan de tener sentido
  delete from public.cross_offsets o where o.status = 'proposed' and exists (select 1 from public.cross_offset_lines l where l.offset_id = o.id and l.space_id = p_space);
  -- Primero los planes: así ningún mes queda «cerrado» mientras se vacía
  delete from public.monthly_plans where space_id = p_space;
  delete from public.expenses where space_id = p_space;
  delete from public.incomes where space_id = p_space;
  for v_account in select id from public.accounts where space_id = p_space loop
    perform public._delete_account(v_account);
  end loop;
  delete from public.spaces where id = p_space;
  insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
  values (null, uid, 'spaces', p_space, 'delete', jsonb_build_object('kind', sp.kind));
  return jsonb_build_object('name', sp.name, 'others', v_users);
end; $$;

/* Salir de un espacio: el historial se queda con el nombre; las cuentas propias vuelven a Personal. */
create or replace function public.leave_space(p_space uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); m public.space_members; v_personal uuid;
begin
  if uid is null then raise exception 'No autorizado'; end if;
  select * into m from public.space_members where space_id = p_space and user_id = uid for update;
  if not found then raise exception 'No autorizado'; end if;
  if m.role = 'owner' then raise exception 'Quien creó el espacio no puede salir: puede borrarlo'; end if;
  select s.id into v_personal from public.spaces s join public.space_members sm on sm.space_id = s.id where s.kind = 'personal' and sm.user_id = uid limit 1;
  if v_personal is not null then
    update public.accounts set space_id = v_personal, is_default = false where space_id = p_space and owner_user_id = uid and kind <> 'shared';
  end if;
  delete from public.mirror_prefs where space_id = p_space and user_id = uid;
  delete from public.favorites where space_id = p_space and user_id = uid;
  update public.space_members set user_id = null, claim_token_hash = null, claim_expires_at = null where id = m.id;
  insert into public.audit_log (space_id, actor, table_name, row_id, action, diff)
  values (p_space, uid, 'space_members', m.id, 'delete', jsonb_build_object('left', true));
end; $$;

revoke execute on function public.dismiss_swipe_hint(), public.delete_item(text, uuid), public.delete_category(uuid, uuid),
  public.set_category_hidden(uuid, boolean), public.delete_fund(uuid, uuid), public.remove_expense_tag(uuid, uuid),
  public.delete_space(uuid), public.leave_space(uuid) from public, anon;
grant execute on function public.dismiss_swipe_hint(), public.delete_item(text, uuid), public.delete_category(uuid, uuid),
  public.set_category_hidden(uuid, boolean), public.delete_fund(uuid, uuid), public.remove_expense_tag(uuid, uuid),
  public.delete_space(uuid), public.leave_space(uuid) to authenticated;
