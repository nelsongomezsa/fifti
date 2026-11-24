-- Paleta de las partidas: un color por partida (punto, barra, gráfica e icono). Solo cambian valores, no columnas.
update public.funds set color = case system_key
  when 'fund.fixed' then '#9AA3AF' when 'fund.daily' then '#7DD3FC' when 'fund.leisure' then '#FDBA74' when 'fund.savings' then '#A78BFA' else color end
where system_key in ('fund.fixed', 'fund.daily', 'fund.leisure', 'fund.savings');

create or replace function public.apply_fund_palette()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  new.color := case new.system_key
    when 'fund.fixed' then '#9AA3AF' when 'fund.daily' then '#7DD3FC' when 'fund.leisure' then '#FDBA74' when 'fund.savings' then '#A78BFA' else new.color end;
  return new;
end $$;
drop trigger if exists funds_palette on public.funds;
create trigger funds_palette before insert on public.funds for each row execute function public.apply_fund_palette();
