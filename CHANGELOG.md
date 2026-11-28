# Cambios

Historial de Fifti por fechas. Formato libre, del más reciente al más antiguo.

## 2026-11-28

- **Varias monedas**: moneda elegible y modificable en cada espacio (también Personal), con un desplegable en vez de texto libre; cuentas y préstamos con su propia moneda y traspasos entre monedas; «Ver en otra moneda» en Inicio y Plan; el reflejo en Personal y las aportaciones funcionan aunque las monedas sean distintas. Corregidos de paso: las sumas de Movimientos mezclaban importes de distintas monedas, editar un gasto en otra moneda lo reconvertía y la compensación entre grupos podía mezclar monedas. Requiere la migración `20261128000028_currencies.sql`. Detalle en `docs/monedas.md`.
- Un id de gasto que no es válido responde 404 (antes 200).
- **Cabecera en el iPhone instalado**: respeta el margen seguro de arriba en todas las pantallas, hojas y avisos; franja oscura bajo la hora para que se lea en los dos temas; más aire entre los botones y acceso a Ajustes también en el menú del +.
- **404 al borrar un gasto**: la hoja del detalle seguía viva en el router después de volver a Movimientos y, al refrescar, pedía un gasto que ya no existía. Ahora el borrado redirige desde el servidor (con aviso «Gasto borrado»), la hoja se cierra al cambiar de ruta y un gasto que ya no existe muestra una pantalla propia en vez de un 404. Lo mismo para gastos fijos; metas y cuentas que ya no existen llevan a su lista.

## 2026-11-26

- **Incidente de producción**: durante un rato todas las rutas devolvieron 500. La causa era que la exclusión de `@swc` en `outputFileTracingExcludes` también quitaba `@swc/helpers`, que Next necesita al arrancar cada función. Se restauró el despliegue anterior y se corrigió excluyendo solo `@swc/core*`, `@swc/counter` y `@swc/types`. Para que no se repita: `npm run check:runtime` arranca la app compilada sin los paquetes excluidos (lista en `scripts/trace-excludes.json`) y exige 200 en las pantallas clave; corre en `npm run check`, en el CI y antes de cada despliegue. Además, `npm run smoke` comprueba producción con GET a `/`, `/login`, `/registro`, `/api/ping` y `/inicio`, y se ejecuta al terminar `npm run deploy`.
- **Arranque en frío**: cada función dejaba de pesar 32 MB (28 MB eran de `sharp`, que no usamos) y ahora pesa 3,5 MB; el calentado con pg_cron pide cada 5 min el proxy y las pantallas de la barra; el proxy informa en `Server-Timing` si la instancia era nueva.
- **Navegación**: pestañas internas y cambio de mes instantáneos (de ~420 ms a ~18 ms), sesión verificada en local sin viaje a Auth, service worker que abre al instante la última copia de las pantallas de la barra.
- **Movimientos** con ingresos, traspasos y aportaciones, «Tipo» y filtros en una hoja; gastos fijos editables y deslizables; hoja de gasto más clara; Ajustes agrupado; texto mínimo de 13 px.
- **Despliegue seguro**: `npm run deploy` pasa antes el barrido de todas las pantallas con sesión real.

## 2026-11-25

- **Cuentas bancarias**: nombre, banco (texto), color, tipo y saldo inicial; saldo calculado, detalle por cuenta, «Ajustar saldo» con ajuste visible, filtro por cuenta en Movimientos y cuenta en gastos, ingresos y gastos fijos. Sin IBAN ni credenciales.
- **Traspasos** entre cuentas (no cuentan como gasto ni ingreso) y **Reparte tu nómina** con traspasos sugeridos según el reparto del plan; aviso opcional el día de cobro.
- **Importar extracto por cuenta**, con duplicados contra lo apuntado a mano (importe, ±2 días, concepto parecido) y ajuste de saldo si el CSV lo trae.
- **Aportar al hogar** desde el + y desde la partida; **Vaciar espacio** (solo su creador, escribiendo el nombre, 10 s para deshacer, aviso a los demás).
- **Rendimiento**: caché de navegación en el cliente, consultas de cada página en una sola tanda, precarga de detalles y respuesta optimista (abrir un detalle con 300 ms de latencia: de 338 a 27 ms).
- **Captcha de Turnstile hasta Supabase Auth** (registro, acceso, recuperación, invitados, cambio de contraseña y borrado de cuenta); el token se pasa como `captchaToken` y lo valida Supabase.
- «Deshacer» espera al id real si se pulsa antes de que termine el guardado; respuesta optimista en formularios y en el borrado; hoja del + en cuadrícula 2×3.
- Límites de tasa en las escrituras del plan y las cuentas; validación del cambio de divisa; estado de la checklist de seguridad en SECURITY.md.
- Documentación: README completo, capturas nuevas y este historial.

## 2026-11-24

- **Rediseño de navegación**: barra Inicio · Movimientos · + · Calendario · Plan; Plan con pestañas Presupuesto, Fijos y Ahorro; Ajustes en el engranaje; nuevos tokens de color y radios; «Espacios» y «partidas» como nombres (es y en).
- **Inicio** rediseñado: previsión de fin de mes, semana y ahorro, próximos cobros, presupuesto, últimos movimientos y la invitación a la pareja en tarjeta pequeña.
- **Calendario** de gastos fijos (mensual, semanal, trimestral, anual) con día seleccionado, «Editar» y «Saltar este mes»; pantalla propia de **Nuevo gasto fijo**.
- **Fase 1–6 de la v2**: atajo de Siri y `/nuevo`; frase rápida con analizador local; reglas de categoría con aprendizaje; importación de extractos (Santander, BBVA, CaixaBank, ING, Revolut, N26); invitación a la pareja, lista de la compra en directo, préstamos y turnos en gastos fijos; presupuesto semanal, tendencias, informe mensual en PDF y recordatorio diario.
- **Fase de interfaz**: sistema visual con profundidad, tema oscuro por defecto, hojas inferiores con arrastre, filtros y filas deslizables en Movimientos, estados vacíos con acción, cifras animadas.
- **Demo unificada**: monta las mismas páginas que la app real con un proveedor de datos en memoria; test de paridad.
- **Calidad**: pruebas de punta a punta con Playwright (móvil y escritorio) y job en CI; barridos de desbordes y de textos rotos.
- Corrección de datos en producción: previsión realista única, tasa de ahorro prevista, categorías sugeridas, enlaces con ancla, esqueletos de carga y streaming en Inicio.
- Token de Realtime renovable, solo `access_token` y en memoria (excepción documentada).
- El + abre al instante con guardado optimista y «Deshacer».

## 2026-11-23

- **Base**: proyecto Next.js, Supabase con RLS forzada, autenticación, marca y contraseñas comprobadas con HIBP.
- **Espacios y miembros**, invitaciones e **invitados sin cuenta**.
- **Gastos**: reparto por mayor resto, gastos privados, ingresos y comentarios.
- **Offline**: cola idempotente en IndexedDB y service worker.
- **Balance**: saldar, modo a cero, compensación entre espacios y resumen.
- **Plan mensual**: partidas por %, bote común, aportaciones y gastos fijos; reflejo en Personal, previsión y cierre de mes.
- **Ahorro**: metas con hitos, retos y reglas de redondeo.
- **Grupos espontáneos** completos: cambio de moneda, QR y cierre de plan.
- **Extras**: tickets con OCR, CSV, notificaciones push, detector de gastos fijos, calendario y «Tu año».
- **Ajustes**: español e inglés, tema claro y oscuro, modo discreto, bloqueo y borrado de cuenta.
- **Landing pública y demo**; Turnstile en la entrada de invitados; funciones en la región `fra1`.
- Licencia MIT y primera documentación.
