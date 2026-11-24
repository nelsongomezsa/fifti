-- Fase 5: lista de la compra compartida, préstamos sueltos y turnos en gastos fijos.

-- ───────── Lista de la compra ─────────
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_expense uuid references public.expenses (id) on delete set null
);
create unique index shopping_one_open_per_space on public.shopping_lists (space_id) where closed_at is null;

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 120 and text = btrim(text)),
  quantity integer not null default 1 check (quantity between 1 and 999),
  checked boolean not null default false,
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index shopping_items_list_idx on public.shopping_items (list_id, created_at);
create index shopping_items_space_idx on public.shopping_items (space_id);

create or replace function public.check_shopping_item()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.shopping_lists l where l.id = new.list_id and l.space_id = new.space_id and l.closed_at is null) then
    raise exception 'La lista no está abierta en esta burbuja' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.shopping_items where list_id = new.list_id) >= 200 then
    raise exception 'La lista está llena (200 artículos)' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger shopping_items_check before insert or update of list_id, space_id on public.shopping_items
  for each row execute function public.check_shopping_item();

alter table public.shopping_lists enable row level security;
alter table public.shopping_lists force row level security;
alter table public.shopping_items enable row level security;
alter table public.shopping_items force row level security;
create policy shopping_lists_select on public.shopping_lists for select to authenticated using (public.is_member(space_id));
create policy shopping_items_select on public.shopping_items for select to authenticated using (public.is_member(space_id));
create policy shopping_items_write on public.shopping_items for all to authenticated
  using (public.is_full_member(space_id)) with check (public.is_full_member(space_id));
grant select on public.shopping_lists to authenticated;
grant select, insert, update, delete on public.shopping_items to authenticated;

create or replace function public.ensure_shopping_list(p_space uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v uuid;
begin
  if auth.uid() is null or not public.is_full_member(p_space) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if (select kind from public.spaces where id = p_space) = 'personal' then raise exception 'La lista es para hogares y grupos' using errcode = '23514'; end if;
  select id into v from public.shopping_lists where space_id = p_space and closed_at is null;
  if v is null then
    insert into public.shopping_lists (space_id) values (p_space) on conflict do nothing returning id into v;
    if v is null then select id into v from public.shopping_lists where space_id = p_space and closed_at is null; end if;
  end if;
  return v;
end $$;
revoke all on function public.ensure_shopping_list(uuid) from public, anon;
grant execute on function public.ensure_shopping_list(uuid) to authenticated;

-- Cierra la lista con el gasto de la compra: lo marcado se archiva y lo que falta pasa a la lista nueva.
create or replace function public.finish_shopping(p_space uuid, p_expense uuid)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_old uuid; v_new uuid; v_names text;
begin
  if auth.uid() is null or not public.is_full_member(p_space) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if not exists (select 1 from public.expenses where id = p_expense and space_id = p_space) then raise exception 'Gasto no válido' using errcode = '23514'; end if;
  select id into v_old from public.shopping_lists where space_id = p_space and closed_at is null for update;
  if v_old is null then return ''; end if;
  select left(string_agg(case when quantity > 1 then text || ' x' || quantity else text end, ', ' order by created_at), 450) into v_names
    from public.shopping_items where list_id = v_old and checked;
  update public.shopping_lists set closed_at = now(), closed_expense = p_expense where id = v_old;
  insert into public.shopping_lists (space_id) values (p_space) returning id into v_new;
  update public.shopping_items set list_id = v_new where list_id = v_old and not checked;
  return coalesce(v_names, '');
end $$;
revoke all on function public.finish_shopping(uuid, uuid) from public, anon;
grant execute on function public.finish_shopping(uuid, uuid) to authenticated;

-- Realtime respetando RLS: solo se publican los artículos
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shopping_items;
  end if;
exception when duplicate_object then null; end $$;

-- ───────── Préstamos sueltos (privados de quien los crea) ─────────
create or replace function public.shares_space_with(p_other uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (
  select 1 from public.space_members a join public.space_members b on a.space_id = b.space_id
  where a.user_id = auth.uid() and b.user_id = p_other and a.user_id <> b.user_id and a.role in ('owner', 'member') and b.role in ('owner', 'member')); $$;
revoke all on function public.shares_space_with(uuid) from public, anon;
grant execute on function public.shares_space_with(uuid) to authenticated;

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  direction text not null check (direction in ('lent', 'borrowed')),
  person_name text not null check (char_length(person_name) between 1 and 40 and person_name = btrim(person_name)),
  linked_user_id uuid references auth.users (id) on delete set null,
  shared boolean not null default false,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  loan_date date not null default current_date,
  remind_on date,
  note text check (note is null or char_length(note) <= 80),
  created_at timestamptz not null default now(),
  check (not shared or linked_user_id is not null)
);
create index loans_user_idx on public.loans (user_id, loan_date desc);
create index loans_linked_idx on public.loans (linked_user_id) where shared;

create table public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  paid_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index loan_repayments_loan_idx on public.loan_repayments (loan_id);

-- Solo se puede vincular a quien comparte burbuja contigo; los pagos no pueden superar lo que queda
create or replace function public.check_loan()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.linked_user_id is not null and not public.shares_space_with(new.linked_user_id) then
    raise exception 'Solo puedes vincular a alguien con quien compartes una burbuja' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger loans_check before insert or update of linked_user_id on public.loans for each row execute function public.check_loan();

create or replace function public.check_repayment()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
declare v_amount bigint; v_paid bigint;
begin
  select amount_cents into v_amount from public.loans where id = new.loan_id and user_id = new.user_id;
  if v_amount is null then raise exception 'Préstamo no encontrado' using errcode = '23514'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.loan_repayments where loan_id = new.loan_id;
  if v_paid + new.amount_cents > v_amount then raise exception 'Lo devuelto supera lo prestado' using errcode = '23514'; end if;
  return new;
end $$;
create trigger loan_repayments_check before insert on public.loan_repayments for each row execute function public.check_repayment();

alter table public.loans enable row level security;
alter table public.loans force row level security;
alter table public.loan_repayments enable row level security;
alter table public.loan_repayments force row level security;
create policy loans_select on public.loans for select to authenticated
  using (user_id = auth.uid() or (shared and linked_user_id = auth.uid() and public.shares_space_with(user_id)));
create policy loans_write on public.loans for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy loan_repayments_select on public.loan_repayments for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.loans l where l.id = loan_id and l.shared and l.linked_user_id = auth.uid() and public.shares_space_with(l.user_id)));
create policy loan_repayments_write on public.loan_repayments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.loans, public.loan_repayments to authenticated;

-- ───────── Turnos en gastos fijos ─────────
alter table public.recurring_expenses add column rotation uuid[] not null default '{}' check (cardinality(rotation) <= 8);
alter table public.recurring_expenses add column rotation_pos integer not null default 0 check (rotation_pos >= 0);

create or replace function public.save_recurring(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_space uuid := (p ->> 'space_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; v_me public.space_members; v_paid text := coalesce(p ->> 'paid_from', 'member');
  v_payer uuid := nullif(p ->> 'payer_member_id', '')::uuid; v_cat uuid := nullif(p ->> 'category_id', '')::uuid; v_fund uuid;
  v_rot uuid[] := coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p -> 'rotation', '[]'::jsonb))), '{}');
begin
  select * into v_me from public.space_members where space_id = v_space and user_id = auth.uid() and role in ('owner', 'member');
  if not found then raise exception 'No autorizado'; end if;
  if v_paid = 'member' then
    v_payer := coalesce(v_payer, v_me.id);
    if not exists (select 1 from public.space_members where id = v_payer and space_id = v_space) then raise exception 'Pagador no válido'; end if;
  else
    if (select kind from public.spaces where id = v_space) <> 'household' then raise exception 'Pago desde el bote no permitido'; end if;
    v_payer := null;
  end if;
  if cardinality(v_rot) > 0 then
    if v_paid <> 'member' or (select kind from public.spaces where id = v_space) = 'personal' then raise exception 'Los turnos son para gastos pagados por personas en hogares o grupos'; end if;
    if cardinality(v_rot) < 2 or cardinality(v_rot) > 8 or cardinality(v_rot) <> (select count(distinct x) from unnest(v_rot) x) then raise exception 'Turnos no válidos'; end if;
    if (select count(*) from public.space_members where space_id = v_space and id = any (v_rot)) <> cardinality(v_rot) then raise exception 'Turnos no válidos'; end if;
    v_payer := v_rot[1];
  end if;
  if v_cat is not null then
    select fund_id into v_fund from public.categories where id = v_cat and space_id = v_space;
    if v_fund is null then raise exception 'Categoría ajena al espacio'; end if;
  end if;
  if v_id is null then
    insert into public.recurring_expenses (space_id, fund_id, category_id, description, amount_cents, frequency, day, next_run, payer_member_id, paid_from, detected, rotation)
    values (v_space, v_fund, v_cat, btrim(p ->> 'description'), (p ->> 'amount_cents')::bigint, coalesce(p ->> 'frequency', 'monthly')::public.recur_freq,
            (p ->> 'day')::int, (p ->> 'next_run')::date, v_payer, v_paid, coalesce((p ->> 'detected')::boolean, false), v_rot)
    returning id into v_id;
  else
    update public.recurring_expenses set fund_id = v_fund, category_id = v_cat, description = btrim(p ->> 'description'), amount_cents = (p ->> 'amount_cents')::bigint,
      frequency = coalesce(p ->> 'frequency', 'monthly')::public.recur_freq, day = (p ->> 'day')::int, next_run = (p ->> 'next_run')::date,
      payer_member_id = v_payer, paid_from = v_paid, active = coalesce((p ->> 'active')::boolean, true),
      rotation_pos = case when rotation is distinct from v_rot then 0 else rotation_pos end, rotation = v_rot
    where id = v_id and space_id = v_space;
    if not found then raise exception 'Gasto fijo no encontrado'; end if;
  end if;
  return v_id;
end; $$;

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
      -- con turnos, paga quien toca; si no, el pagador fijo
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
      i := i + 1;
      v_run := case r.frequency when 'weekly' then v_run + 7
                 when 'monthly' then (date_trunc('month', v_run) + interval '1 month')::date + (least(r.day, extract(day from (date_trunc('month', v_run) + interval '2 month - 1 day'))::int) - 1)
                 else (v_run + interval '1 year')::date end;
    end loop;
    update public.recurring_expenses set next_run = v_run, rotation_pos = v_pos where id = r.id;
  end loop;
  return n;
end; $$;
revoke all on function public.process_recurring() from public, anon, authenticated;
grant execute on function public.process_recurring() to service_role;
revoke all on function public.save_recurring(jsonb) from public, anon;
grant execute on function public.save_recurring(jsonb) to authenticated;
