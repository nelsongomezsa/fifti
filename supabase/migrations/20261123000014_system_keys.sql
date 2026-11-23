-- Fondos y categorías por defecto con clave interna (system_key): la interfaz los muestra traducidos según el idioma.
-- Los que crea el usuario no tienen clave y se muestran con su nombre.

alter table public.funds add column system_key text check (system_key is null or system_key ~ '^fund\.[a-z_]+$');
alter table public.categories add column system_key text check (system_key is null or system_key ~ '^cat\.[a-z_]+$');
create unique index funds_system_key_uniq on public.funds (space_id, system_key) where system_key is not null;
create unique index categories_system_key_uniq on public.categories (space_id, system_key) where system_key is not null;

-- La clave la ponen solo las funciones del sistema: los clientes no pueden fijarla ni cambiarla
revoke insert, update on public.funds, public.categories from authenticated;
grant insert (space_id, name, kind, color, icon, rollover, linked_space_id, position) on public.funds to authenticated;
grant update (name, kind, color, icon, rollover, linked_space_id, position) on public.funds to authenticated;
grant insert (space_id, fund_id, name, icon, color) on public.categories to authenticated;
grant update (name, icon, color, fund_id) on public.categories to authenticated;

-- Si el usuario renombra un elemento del sistema, pasa a ser suyo: se pierde la clave y se muestra su nombre
create or replace function public.clear_system_key_on_rename()
returns trigger language plpgsql as $$
begin
  if new.name is distinct from old.name then new.system_key := null; end if;
  return new;
end; $$;
create trigger funds_rename_clears_key before update of name on public.funds for each row execute function public.clear_system_key_on_rename();
create trigger categories_rename_clears_key before update of name on public.categories for each row execute function public.clear_system_key_on_rename();

-- ───────── Siembra con claves ─────────
create or replace function public._seed_fund(p_space uuid, p_skey text, p_name text, p_kind public.fund_kind, p_color text, p_pos integer)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v uuid;
begin
  insert into public.funds (space_id, name, kind, color, position, system_key) values (p_space, p_name, p_kind, p_color, p_pos, p_skey) returning id into v;
  return v;
end; $$;
create or replace function public._seed_cats(p_space uuid, p_fund uuid, p_skeys text[], p_names text[])
returns void language sql security definer set search_path = public, pg_temp
as $$
  insert into public.categories (space_id, fund_id, name, system_key)
  select p_space, p_fund, n, sk from unnest(p_skeys, p_names) as t(sk, n);
$$;
revoke all on function public._seed_fund(uuid, text, text, public.fund_kind, text, integer), public._seed_cats(uuid, uuid, text[], text[]) from public, anon, authenticated;

create or replace function public.seed_space_defaults()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare f uuid;
begin
  if new.kind = 'group' then
    f := public._seed_fund(new.id, 'fund.general', 'General', 'variable', '#FF9F43', 0);
    if new.template = 'night' then
      perform public._seed_cats(new.id, f, array['cat.cocktails','cat.tickets','cat.taxi','cat.food','cat.other'], array['Copas','Entradas','Taxi','Comida','Otros']);
    elsif new.template = 'dinner' then
      perform public._seed_cats(new.id, f, array['cat.food','cat.drinks','cat.dessert','cat.tip','cat.other'], array['Comida','Bebida','Postre','Propina','Otros']);
    elsif new.template = 'trip' then
      perform public._seed_cats(new.id, f, array['cat.lodging','cat.transport','cat.food','cat.activities','cat.shopping','cat.other'], array['Alojamiento','Transporte','Comida','Actividades','Compras','Otros']);
    elsif new.template = 'flat' then
      perform public._seed_cats(new.id, f, array['cat.rent','cat.electricity','cat.water','cat.internet','cat.purchase','cat.cleaning'], array['Alquiler','Luz','Agua','Internet','Compra','Limpieza']);
    else
      perform public._seed_cats(new.id, f, array['cat.food','cat.drinks','cat.transport','cat.lodging','cat.leisure','cat.other'], array['Comida','Bebida','Transporte','Alojamiento','Ocio','Otros']);
    end if;
    return new;
  end if;

  f := public._seed_fund(new.id, 'fund.fixed', 'Gastos fijos', 'fixed', '#9AA3AF', 0);
  perform public._seed_cats(new.id, f, array['cat.rent','cat.electricity','cat.water','cat.internet','cat.subscriptions'], array['Alquiler','Luz','Agua','Internet','Suscripciones']);
  f := public._seed_fund(new.id, 'fund.daily', 'Día a día', 'variable', '#7DD3FC', 1);
  perform public._seed_cats(new.id, f, array['cat.groceries','cat.transport','cat.health','cat.home'], array['Supermercado','Transporte','Salud','Casa']);
  f := public._seed_fund(new.id, 'fund.leisure', 'Ocio', 'leisure', '#FF9F43', 2);
  perform public._seed_cats(new.id, f, array['cat.outings','cat.restaurants','cat.shopping','cat.trips'], array['Salidas','Restaurantes','Compras','Viajes']);
  f := public._seed_fund(new.id, 'fund.savings', 'Ahorro', 'savings', '#A78BFA', 3);
  perform public._seed_cats(new.id, f, array['cat.savings'], array['Ahorro']);
  f := public._seed_fund(new.id, 'fund.emergency', 'Imprevistos', 'emergency', '#FF6B6B', 4);
  perform public._seed_cats(new.id, f, array['cat.emergency'], array['Imprevistos']);
  if new.kind = 'personal' then
    f := public._seed_fund(new.id, 'fund.investment', 'Inversión', 'investment', '#C6F432', 5);
    perform public._seed_cats(new.id, f, array['cat.investment'], array['Inversión']);
    f := public._seed_fund(new.id, 'fund.contribution', 'Aportación al hogar', 'contribution', '#C6F432', 6);
    perform public._seed_cats(new.id, f, array['cat.household_contribution'], array['Aportación al hogar']);
  end if;
  return new;
end; $$;

-- ───────── Datos que ya existían: se marcan los que coinciden con los de fábrica ─────────
with m(name, kind, sk) as (values
  ('Gastos fijos','fixed','fund.fixed'),('Día a día','variable','fund.daily'),('Ocio','leisure','fund.leisure'),('Ahorro','savings','fund.savings'),
  ('Imprevistos','emergency','fund.emergency'),('Inversión','investment','fund.investment'),('Aportación al hogar','contribution','fund.contribution'),('General','variable','fund.general')),
c as (select f.id, m.sk, row_number() over (partition by f.space_id, m.sk order by f.id) rn
      from public.funds f join m on m.name = f.name and m.kind::public.fund_kind = f.kind)
update public.funds f set system_key = c.sk from c where c.id = f.id and c.rn = 1 and f.system_key is null;

with m(fund_sk, name, sk) as (values
  ('fund.fixed','Alquiler','cat.rent'),('fund.fixed','Luz','cat.electricity'),('fund.fixed','Agua','cat.water'),('fund.fixed','Internet','cat.internet'),('fund.fixed','Suscripciones','cat.subscriptions'),
  ('fund.daily','Supermercado','cat.groceries'),('fund.daily','Transporte','cat.transport'),('fund.daily','Salud','cat.health'),('fund.daily','Casa','cat.home'),
  ('fund.leisure','Salidas','cat.outings'),('fund.leisure','Restaurantes','cat.restaurants'),('fund.leisure','Compras','cat.shopping'),('fund.leisure','Viajes','cat.trips'),
  ('fund.savings','Ahorro','cat.savings'),('fund.emergency','Imprevistos','cat.emergency'),('fund.investment','Inversión','cat.investment'),('fund.contribution','Aportación al hogar','cat.household_contribution'),
  ('fund.general','Comida','cat.food'),('fund.general','Bebida','cat.drinks'),('fund.general','Transporte','cat.transport'),('fund.general','Alojamiento','cat.lodging'),('fund.general','Ocio','cat.leisure'),
  ('fund.general','Otros','cat.other'),('fund.general','Copas','cat.cocktails'),('fund.general','Entradas','cat.tickets'),('fund.general','Taxi','cat.taxi'),('fund.general','Postre','cat.dessert'),
  ('fund.general','Propina','cat.tip'),('fund.general','Actividades','cat.activities'),('fund.general','Compras','cat.shopping'),('fund.general','Alquiler','cat.rent'),('fund.general','Luz','cat.electricity'),
  ('fund.general','Agua','cat.water'),('fund.general','Internet','cat.internet'),('fund.general','Compra','cat.purchase'),('fund.general','Limpieza','cat.cleaning')),
c as (select ca.id, m.sk, row_number() over (partition by ca.space_id, m.sk order by ca.id) rn
      from public.categories ca join public.funds f on f.id = ca.fund_id join m on m.fund_sk = f.system_key and m.name = ca.name)
update public.categories ca set system_key = c.sk from c where c.id = ca.id and c.rn = 1 and ca.system_key is null;
