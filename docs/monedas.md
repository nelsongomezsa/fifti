# Varias monedas

## Qué moneda tiene cada cosa

| Dato | Moneda |
|---|---|
| Espacio (Personal, hogar, plan) | La suya: en ella se suma y se ve todo |
| Gasto | La que se apuntó (`amount_cents`, `currency`) y su equivalente en la del espacio (`fx_rate`, `amount_base_cents`) |
| Ingresos, plan, gastos fijos, metas, favoritos, pagos entre personas | La del espacio |
| Cuenta | La suya. Un traspaso entre monedas guarda lo que sale y lo que llega |
| Préstamo | La que tenía tu Personal al apuntarlo |

Monedas admitidas: las 16 de `src/lib/fx.ts`. La base de datos las exige con `is_supported_currency`.

## Cambiar la moneda de un espacio

Solo la persona propietaria. Lo hace `change_space_currency`, en una sola transacción y con registro en `audit_log`.

- **Gastos:** el importe y la moneda originales no se tocan. Se recalculan el cambio **del día de cada gasto**, el total y el reparto.
- **Ingresos:** al cambio de su día; se guarda el importe original, así que volver atrás no acumula redondeos.
- **Pagos entre personas:** al cambio de su día. Si ya estaban saldadas las cuentas, puede quedar una diferencia pequeña.
- **Plan, gastos fijos, metas, favoritos, aportaciones y presupuesto diario:** al cambio **del día en que se cambia**. Los porcentajes se mantienen. El redondeo para metas ("al siguiente 1") no se convierte.
- **Cuentas y préstamos:** conservan su moneda; sus saldos no cambian.
- **Compensaciones pendientes** de ese espacio: se anulan.
- Si falta el cambio de algún día, no se modifica nada.

## De dónde salen los cambios

Frankfurter (datos del BCE), consultado solo desde el servidor, con tiempo límite y caché en `fx_rates`. A la API solo viajan códigos de moneda y fechas. La base de datos nunca acepta un cambio que venga del navegador al convertir: lee la caché.

Los totales en otra moneda ("Ver en…") y el total de cuentas usan el cambio de hoy, se marcan como aproximados y no modifican ningún dato.
