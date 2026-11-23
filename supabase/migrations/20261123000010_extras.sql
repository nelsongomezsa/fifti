-- Fase 10: tickets (bucket privado), notificaciones push y preferencias.

-- ───────── Tickets: bucket PRIVADO, solo webp, 5 MB, política por espacio ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/webp'];

create or replace function public._receipt_space(p_name text)
returns uuid language sql immutable set search_path = public, pg_temp
as $$ select case when (string_to_array(p_name, '/'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then ((string_to_array(p_name, '/'))[1])::uuid end; $$;
grant execute on function public._receipt_space(text) to authenticated;

create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public._receipt_space(name) is not null and public.is_member(public._receipt_space(name)));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public._receipt_space(name) is not null and public.is_member(public._receipt_space(name))
              and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$');
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and owner = auth.uid());

create or replace function public.attach_receipt(p_expense uuid, p_path text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare e public.expenses; me public.space_members;
begin
  select * into e from public.expenses where id = p_expense;
  if not found then raise exception 'Gasto no encontrado'; end if;
  select * into me from public.space_members where space_id = e.space_id and user_id = auth.uid();
  if not found then raise exception 'No autorizado'; end if;
  if me.role = 'guest' and e.created_by_member <> me.id then raise exception 'No autorizado'; end if;
  if p_path !~ ('^' || e.space_id::text || '/[0-9a-f-]{36}\.webp$') then raise exception 'Ruta de ticket no válida'; end if;
  if e.is_private then
    if e.created_by_member <> me.id then raise exception 'No autorizado'; end if;
    update public.expense_private_details set receipt_path = p_path where expense_id = p_expense;
  else
    update public.expenses set receipt_path = p_path where id = p_expense;
  end if;
end; $$;
revoke all on function public.attach_receipt(uuid, text) from public, anon;
grant execute on function public.attach_receipt(uuid, text) to authenticated;

-- ───────── Push ─────────
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  created_at timestamptz not null default now()
);
create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  new_expense boolean not null default true,
  fixed_tomorrow boolean not null default true,
  fund_threshold boolean not null default true,
  goal_reached boolean not null default true,
  monthly_summary boolean not null default true,
  contribution_pending boolean not null default true,
  offset_proposal boolean not null default true
);
-- Registro para no repetir avisos (solo service_role)
create table public.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
alter table public.notification_prefs enable row level security;
alter table public.notification_prefs force row level security;
alter table public.notification_log enable row level security;
alter table public.notification_log force row level security;
revoke all on public.push_subscriptions, public.notification_prefs, public.notification_log from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant select, insert, update on public.notification_prefs to authenticated;
create policy push_own_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_own_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid() and not public.is_guest_user());
create policy push_own_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
create policy prefs_own_select on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy prefs_own_insert on public.notification_prefs for insert to authenticated with check (user_id = auth.uid());
create policy prefs_own_update on public.notification_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
