-- Editar un ingreso: save_income acepta `id` y actualiza (misma autorización que al crearlo).
create or replace function public.save_income(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_space uuid := (p ->> 'space_id')::uuid; v_member uuid := (p ->> 'member_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; m public.space_members;
begin
  if not public.is_full_member(v_space) then raise exception 'No autorizado'; end if;
  select * into m from public.space_members where id = v_member and space_id = v_space;
  if not found then raise exception 'Miembro ajeno al espacio'; end if;
  if not (m.user_id = auth.uid() or (m.user_id is null and public.is_owner(v_space))) then raise exception 'No autorizado'; end if;
  if v_id is null then
    insert into public.incomes (space_id, member_id, amount_cents, currency, source, received_at, is_recurring)
    values (v_space, v_member, (p ->> 'amount_cents')::bigint, (select base_currency from public.spaces where id = v_space),
            left(btrim(coalesce(p ->> 'source', 'Nómina')), 60), (p ->> 'received_at')::date, coalesce((p ->> 'is_recurring')::boolean, false))
    returning id into v_id;
  else
    -- solo se edita un ingreso propio (o de un miembro sin cuenta si eres propietario) de esta burbuja
    update public.incomes i set member_id = v_member, amount_cents = (p ->> 'amount_cents')::bigint, source = left(btrim(coalesce(p ->> 'source', 'Nómina')), 60),
      received_at = (p ->> 'received_at')::date, is_recurring = coalesce((p ->> 'is_recurring')::boolean, false)
    where i.id = v_id and i.space_id = v_space
      and exists (select 1 from public.space_members om where om.id = i.member_id and (om.user_id = auth.uid() or (om.user_id is null and public.is_owner(v_space))));
    if not found then raise exception 'Ingreso no encontrado'; end if;
  end if;
  return v_id;
end; $$;
revoke all on function public.save_income(jsonb) from public, anon;
grant execute on function public.save_income(jsonb) to authenticated;
