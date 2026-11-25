# Fifti

*Cuentas claras en casa, en pareja y de fiesta.*

PWA de finanzas personales, de pareja y de grupo. El dinero se organiza en **espacios**:

- **Personal**: privada. Ingresos, gastos, plan del mes y metas.
- **Hogar** (fija): pareja o piso, con bote común proporcional a los ingresos, gastos fijos y ahorro.
- **Plan espontáneo**: una cena o un viaje. Se comparte por enlace o QR, entran sin cuenta y al cerrarlo sale quién paga a quién.

**Qué la diferencia de Tricount:** todo está conectado. Tu parte de cada gasto de grupo entra sola en tu plan personal, así sabes lo que gastas de verdad en el mes (casa + pareja + salidas). Además tiene presupuesto mensual por partidas, previsión de fin de mes, cierre de mes, bote común y metas de ahorro.

Prueba la demo (datos ficticios, sin registro) en `/demo`.

## Funciones

- **Inicio**: cuánto te sobrará a final de mes, lo que puedes gastar esta semana, ahorro previsto, próximos cobros, presupuesto por partidas y últimos movimientos.
- **Apuntar rápido**: el botón **+** ofrece gasto, gasto fijo, ingreso, aportación a una meta y préstamo; también acepta una frase («12 cena con Leo a medias»), un atajo de Siri y favoritos con pulsación larga.
- **Calendario** de gastos fijos (mensual, semanal, trimestral, anual) con avisos antes del cobro y «saltar este mes».
- **Plan**: Presupuesto (reparto por partidas y cierre de mes), Fijos y Ahorro (metas con ritmo).
- **Pareja y grupos**: invitación a la pareja, lista de la compra, préstamos, pagador rotativo y balance de quién debe a quién.
- **Importar del banco** (CSV) con detección de formato y duplicados, reglas de categoría y resumen mensual en PDF.
- **Tendencias** por partida y recordatorio diario opcional.

## Capturas

Capturas reales de la demo (`/demo`, datos ficticios: Ana, Leo, «Viaje Lisboa»), a 390 px.

| Inicio | Calendario | Plan: Presupuesto |
|---|---|---|
| ![Inicio](docs/capturas/01-inicio.png) | ![Calendario](docs/capturas/02-calendario.png) | ![Presupuesto](docs/capturas/03-plan-presupuesto.png) |

| Plan: Fijos | Movimientos | Nuevo gasto fijo |
|---|---|---|
| ![Fijos](docs/capturas/04-plan-fijos.png) | ![Movimientos](docs/capturas/05-movimientos.png) | ![Nuevo gasto fijo](docs/capturas/06-nuevo-gasto-fijo.png) |

| Ajustes |
|---|
| ![Ajustes](docs/capturas/07-ajustes.png) |

## Stack

Next.js 16 (App Router) · TypeScript estricto · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage, RLS, pg_cron) · Zod · Recharts + d3-hierarchy · next-intl · tesseract.js · Vitest · Vercel

## Decisiones técnicas

- **Dinero en céntimos** (enteros; `bigint` en Postgres) y **porcentajes en puntos básicos** (10000 = 100 %). Los repartos usan el método del mayor resto: la suma siempre cuadra al céntimo. Toda la lógica de dinero son funciones puras en `src/lib/money`, con tests de propiedades.
- **RLS en todas las tablas** (38) con `FORCE ROW LEVEL SECURITY`, privilegios por columna y funciones `security definer` con `search_path` fijo. Las escrituras sensibles (gastos, liquidaciones, invitaciones, compensaciones) van por RPC atómicas que validan pertenencia, sumas e importes.
- **Sesión en cookies `httpOnly`** (`@supabase/ssr`); no hay cliente de Supabase en el navegador y la `service_role` solo existe en el servidor (`server-only`).
- **Invitados sin cuenta** = sesiones anónimas de Supabase Auth, ligadas por RLS a un solo grupo y un solo perfil; pueden convertirse en cuenta conservando su historial.
- **Enlaces** (invitación, invitado, reclamar perfil, resumen público): token de 32 bytes, solo se guarda su hash, con caducidad, usos máximos y revocación.
- **Sincronización offline**: cola en IndexedDB con `client_id` idempotente; reenviar nunca duplica. Service worker propio con lectura offline y sin cachear páginas con tokens.
- **Gastos privados** dentro de un grupo: el detalle vive en una tabla aparte legible solo por su autor; los demás ven «Gasto privado» con importe y reparto.
- **Historial** inmutable (solo inserción) escrito por triggers.
- **Tickets**: tipo real por magic bytes, máx. 5 MB, recodificado a WebP sin EXIF, bucket privado y URL firmada de 5 minutos. OCR en el navegador con archivos servidos desde el propio dominio.
- **Contraseñas** comprobadas contra Have I Been Pwned por k-anonymity (solo salen 5 caracteres del hash SHA-1).
- **CSV**: escape de inyección de fórmulas al exportar; al importar, límites de tamaño y filas, validación por fila y vista previa.

## Cómo ejecutarlo

Requisitos: Node 24+ y Docker (Supabase local y tests de RLS).

```bash
npm install
cp .env.example <tu archivo local de entorno>   # y rellena las claves
npx supabase start                              # base de datos local con las migraciones
npm run dev
```

Variables: URL y clave anónima de Supabase, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`, `CRON_SECRET`, y las claves VAPID (`npx web-push generate-vapid-keys`) para las notificaciones.

Scripts: `npm test` (lógica de dinero, validación, CSV, cola offline…), `npm run test:rls` (políticas contra Supabase), `npm run lint`, `npm run typecheck`, `npm run check` (todo + build), `npm run icons` (logo e iconos).

## Calidad

- `npm test`: lógica de dinero, previsión, calendario, validación, CSV, parser de frases, cola offline y contraste de color (AA) del tema oscuro y claro.
- `npm run test:rls`: políticas de RLS contra Supabase local.
- `npx playwright test`: pruebas de punta a punta con sesión real (apuntar un gasto y deshacer, sin conexión, hogar y balance, lista de la compra, importación CSV, cierre de mes, Ajustes), en móvil (390×844) y escritorio. Necesitan la app compilada y un Supabase local; cada prueba crea sus usuarios ficticios y los borra. La del invitado con Turnstile solo se ejecuta si la app se compiló con las claves de prueba de Cloudflare (`E2E_TURNSTILE_TEST=1`).
- `npm run e2e:overflow` y `npm run e2e:parity`: sin desbordes horizontales a 390 px en oscuro y claro, y mismos elementos tocables en la demo y en una cuenta real.
- **CI** (GitHub Actions): lint, tipos, tests, auditoría de dependencias, gitleaks, OSV, RLS y e2e con Playwright sobre Supabase local; las trazas y capturas solo se suben si algo falla.

## Pendiente (opcional)

- **Monitorización de errores (Sentry)**: no está activada. Los pasos y las condiciones de privacidad (sin datos personales, sin replay, CSP solo al host de ingestión) están en [SECURITY.md](SECURITY.md).

## Licencia

MIT. Ver [LICENSE](LICENSE).

## Seguridad

CI con `gitleaks`, `osv-scanner`, `npm audit` y Dependabot. En el repo solo hay archivos de ejemplo de variables; ningún secreto ni dato real.
