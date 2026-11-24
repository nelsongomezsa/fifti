-- Gastos fijos: frecuencia trimestral y «saltar este mes» (solo esa ocurrencia).
alter type public.recur_freq add value if not exists 'quarterly';

create table public.recurring_skips (
  recurring_id uuid not null references public.recurring_expenses (id) on delete cascade,
  skip_on date not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (recurring_id, skip_on)
);
alter table public.recurring_skips enable row level security;
alter table public.recurring_skips force row level security;
create policy recurring_skips_select on public.recurring_skips for select to authenticated
  using (exists (select 1 from public.recurring_expenses r where r.id = recurring_id and public.is_member(r.space_id)));
grant select on public.recurring_skips to authenticated;

-- Saltar (o dejar de saltar) una ocurrencia concreta: solo miembros con permiso de escritura, y solo fechas que pertenecen al gasto fijo.
create or replace function public.set_recurring_skip(p_recurring uuid, p_date date, p_skip boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.recurring_expenses;
begin
  select * into r from public.recurring_expenses where id = p_recurring;
  if not found or auth.uid() is null or not public.is_full_member(r.space_id) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_date < r.next_run then raise exception 'Esa fecha ya pasó' using errcode = '23514'; end if;
  if p_skip then
    insert into public.recurring_skips (recurring_id, skip_on) values (p_recurring, p_date) on conflict do nothing;
  else
    delete from public.recurring_skips where recurring_id = p_recurring and skip_on = p_date;
  end if;
end $$;
revoke all on function public.set_recurring_skip(uuid, date, boolean) from public, anon;
grant execute on function public.set_recurring_skip(uuid, date, boolean) to authenticated;

create or replace function public.process_recurring()
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.recurring_expenses; n integer := 0; v_run date; v_exp uuid; v_cur char(3); v_creator uuid; v_payer uuid; v_pos integer; v_n integer; i integer; s record;
begin
  for r in select * from public.recurring_expenses where active and next_run <= current_date for update skip locked loop
    select base_currency into v_cur from public.spaces where id = r.space_id and archived_at is null;
    continue when v_cur is null;
    v_n := coalesce(cardinality(r.rotation), 0); v_pos := r.rotation_pos;
    v_run := r.next_run; i := 0;
    while v_run <= current_date and i < 12 loop
      if exists (select 1 from public.recurring_skips k where k.recurring_id = r.id and k.skip_on = v_run) then
        null; -- ocurrencia saltada: no se crea el gasto ni gira el turno
      else
        v_payer := case when r.paid_from = 'member' and v_n > 1 then r.rotation[(v_pos % v_n) + 1] else r.payer_member_id end;
        v_creator := coalesce(v_payer, (select id from public.space_members where space_id = r.space_id and role = 'owner' limit 1));
        begin
          insert into public.expenses (space_id, client_id, description, category_id, spent_at, amount_cents, currency, amount_base_cents, paid_from, split_mode, recurring_id, created_by_member)
          values (r.space_id, gen_random_uuid(), r.description, r.category_id, v_run, r.amount_cents, v_cur, r.amount_cents, r.paid_from, 'default', r.id, v_creator)
          returning id into v_exp;
          if r.paid_from = 'member' then insert into public.expense_payers values (v_exp, v_payer, r.amount_cents); end if;
          for s in select * from public._default_split(r.space_id, r.amount_cents) loop
            insert into public.expense_splits values (v_exp, s.member_id, s.share_bp, s.amount_cents);
          end loop;
          n := n + 1; v_pos := v_pos + 1;
        exception when others then null; -- p. ej. mes cerrado: se omite ese cobro y se sigue
        end;
      end if;
      i := i + 1;
      v_run := case r.frequency when 'weekly' then v_run + 7
                 when 'monthly' then (date_trunc('month', v_run) + interval '1 month')::date + (least(r.day, extract(day from (date_trunc('month', v_run) + interval '2 month - 1 day'))::int) - 1)
                 when 'quarterly' then (date_trunc('month', v_run) + interval '3 months')::date + (least(r.day, extract(day from (date_trunc('month', v_run) + interval '4 month - 1 day'))::int) - 1)
                 else (v_run + interval '1 year')::date end;
    end loop;
    update public.recurring_expenses set next_run = v_run, rotation_pos = v_pos where id = r.id;
  end loop;
  return n;
end; $$;
revoke all on function public.process_recurring() from public, anon, authenticated;
grant execute on function public.process_recurring() to service_role;
