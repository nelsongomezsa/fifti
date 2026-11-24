-- Fase 6: desglose mensual por categoría (y por fondo en el espejo personal) para la pantalla de tendencias. Respetan RLS.
create or replace function public.monthly_breakdown(p_space uuid, p_from date)
returns table (month date, category_id uuid, total_cents bigint) language sql stable security invoker set search_path = public
as $$
  select date_trunc('month', spent_at)::date, category_id, sum(amount_base_cents)::bigint from public.expenses
  where space_id = p_space and spent_at >= p_from group by 1, 2 order by 1;
$$;
create or replace function public.monthly_mirror_by_fund(p_from date)
returns table (month date, fund_id uuid, total_cents bigint) language sql stable security invoker set search_path = public
as $$
  select date_trunc('month', spent_at)::date, fund_id, sum(amount_cents)::bigint from public.personal_mirror
  where user_id = auth.uid() and enabled and spent_at >= p_from group by 1, 2 order by 1;
$$;
revoke all on function public.monthly_breakdown(uuid, date), public.monthly_mirror_by_fund(date) from public, anon;
grant execute on function public.monthly_breakdown(uuid, date), public.monthly_mirror_by_fund(date) to authenticated;
