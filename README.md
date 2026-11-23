# Fifti

*Cuentas claras en casa, en pareja y de fiesta.*

PWA de finanzas personales, de pareja y de grupo. El dinero se organiza en **burbujas**: personal (privada), fija (hogar o pareja) y espontánea (una cena, un viaje). Todo está conectado: tu parte de cada gasto de grupo entra sola en tu plan personal.

> En desarrollo por fases. Estado actual: **fase 1 (base)**.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, RLS) · Vitest · Vercel

## Requisitos

- Node 24+
- Docker (para Supabase local y los tests de RLS)

## Puesta en marcha

```bash
npm install
cp .env.example <tu archivo local de entorno>   # rellena las claves de tu proyecto Supabase
npx supabase start                              # base de datos local con las migraciones
npm run dev
```

Scripts útiles: `npm test` (lógica de dinero y validación), `npm run test:rls` (políticas RLS contra Supabase), `npm run lint`, `npm run typecheck`, `npm run icons` (regenera logo e iconos).

## Decisiones técnicas

- **Dinero en céntimos** (enteros; `bigint` en Postgres) y **porcentajes en puntos básicos** (10000 = 100 %). Los repartos usan el método del mayor resto, así la suma siempre cuadra al céntimo.
- **Sesión en cookies `httpOnly`** (`@supabase/ssr`), sin tokens en `localStorage`. Todo el acceso a datos pasa por el servidor.
- **RLS en todas las tablas**, con `FORCE ROW LEVEL SECURITY` y privilegios por columna.
- **Rate limiting** en Postgres (RPC atómica), con IPs y emails anonimizados con hash y sal.
- **Contraseñas** comprobadas contra Have I Been Pwned por k-anonymity (solo salen 5 caracteres del hash).
- **Logo en SVG con trazados**, generado desde la tipografía, para que se vea igual en todas partes.

## Seguridad

CI con `gitleaks`, `osv-scanner`, `npm audit` y Dependabot. No hay secretos en el repo: solo el archivo de ejemplo de variables.
