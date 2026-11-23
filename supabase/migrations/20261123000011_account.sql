-- Fase 11: borrar la cuenta sin romper los grupos de otras personas.

-- Los grupos sobreviven a quien los creó
alter table public.spaces alter column created_by drop not null;
alter table public.spaces drop constraint spaces_created_by_fkey;
alter table public.spaces add constraint spaces_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
-- Una compensación borrada (al borrar una cuenta) no debe bloquear: las liquidaciones se conservan
alter table public.settlements drop constraint settlements_offset_id_fkey;
alter table public.settlements add constraint settlements_offset_id_fkey foreign key (offset_id) references public.cross_offsets (id) on delete set null;

-- Prepara el borrado: traspasa la propiedad de los grupos, borra los vacíos y la burbuja personal, y anonimiza el nombre
create or replace function public.prepare_account_deletion()
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); s record; v_next uuid;
begin
  if uid is null or public.is_guest_user() then raise exception 'No autorizado'; end if;
  for s in select sp.id from public.spaces sp join public.space_members m on m.space_id = sp.id
           where m.user_id = uid and m.role = 'owner' and sp.kind <> 'personal' loop
    select id into v_next from public.space_members where space_id = s.id and user_id is not null and user_id <> uid order by joined_at limit 1;
    if v_next is null then
      delete from public.spaces where id = s.id; -- nadie más con cuenta: se borra el espacio
    else
      update public.space_members set role = 'owner' where id = v_next;
    end if;
  end loop;
  delete from public.spaces where kind = 'personal' and created_by = uid;
  update public.space_members set display_name = 'Usuario eliminado', claim_token_hash = null, claim_expires_at = null where user_id = uid;
end; $$;
revoke all on function public.prepare_account_deletion() from public, anon;
grant execute on function public.prepare_account_deletion() to authenticated;
