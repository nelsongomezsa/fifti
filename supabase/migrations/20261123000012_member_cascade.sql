-- Borrar un espacio borra sus miembros y, con ellos, todo lo que los referencia (gastos, pagos, repartos...).
-- Los miembros solo se eliminan al borrar el espacio (quien se va queda como miembro virtual), así que es seguro.
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'public.space_members'::regclass and c.confdeltype = 'a'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s on delete cascade', r.tbl, r.conname, r.def);
  end loop;
end $$;
