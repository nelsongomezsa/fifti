# Seguridad de Fifti

Resumen de las medidas del proyecto y de las excepciones que se han tomado a propósito.

## Medidas generales

- RLS activada y forzada en todas las tablas, con tests contra una base de datos real.
- Validación en el servidor con Zod `.strict()` en cada acción; nada se confía a lo que envía el cliente.
- Sesión en cookies `httpOnly` (`@supabase/ssr`); sin `service_role` en el frontend.
- Rate limiting por IP y por usuario en las acciones sensibles; comprobación de contraseñas filtradas (HIBP).
- Cabeceras de seguridad y CSP estricta (`next.config.ts`).
- Dinero en céntimos enteros; porcentajes en puntos básicos.

## Estado de la checklist de 20 puntos

Revisión del 25-11-2026 contra el código y las migraciones.

| # | Punto | Estado | Cómo se ha comprobado |
|---|---|---|---|
| 1 | Sin archivos de entorno ni secretos en git | Cumple | gitleaks sobre todo el historial: sin hallazgos; solo se versionan las plantillas de ejemplo; los archivos locales están ignorados |
| 2 | Sin claves secretas en el frontend | Cumple | `service_role` solo en `src/lib/supabase/admin.ts` (`server-only`); la clave VAPID privada solo en el servidor |
| 3 | RLS en todas las tablas | Cumple | Las 48 tablas de `public` tienen `enable` + `force row level security` (revisión de las migraciones); 122 tests de RLS contra una base real |
| 4 | Permisos en el servidor | Cumple | RLS + acciones de servidor; las funciones `security definer` validan pertenencia (tests: vaciar espacio, cuentas, traspasos, ajustes) |
| 5 | Rate limiting | Cumple | login, registro, recuperar, invitaciones, invitado, reclamar, comentarios, importar CSV, resumen público, fotos y escrituras del plan y las cuentas (`src/lib/security/rate-limit.ts`); falla cerrado |
| 6 | SQL parametrizado | Cumple | Solo cliente de Supabase y RPC; sin SQL concatenado |
| 7 | Zod en el servidor | Cumple | Esquemas `.strict()` en las acciones; las de preferencias usan listas blancas y `getFxPreview` valida con `strictObject` |
| 8 | Sin `dangerouslySetInnerHTML` | Cumple | 0 usos en `src`; regla de ESLint |
| 9 | Contraseñas en Supabase Auth | Cumple | No se guardan contraseñas propias |
| 10 | Sesión en cookies `httpOnly` | Cumple | `@supabase/ssr`; el token de Realtime es la excepción E1 (solo `access_token`, en memoria) |
| 11 | Rutas de admin con rol | No aplica | No hay panel de administración |
| 12 | CORS con lista blanca | Cumple | Ninguna ruta emite cabeceras CORS (solo mismo origen) |
| 13 | Email confirmado antes de usar la cuenta | Parcial | `enable_confirmations = true` en `supabase/config.toml` (local y producción). No se ha podido leer el ajuste vivo de la nube: comprobar en Supabase → Authentication → Providers → Email → «Confirm email» |
| 14 | IDOR | Cumple | UUID + RLS + tests (cuentas, traspasos y espacios ajenos) |
| 15 | Mass assignment | Cumple | Zod `.strict()` y listas blancas |
| 16 | Webhooks | No aplica | No hay |
| 17 | Sin stack traces | Cumple | Mensajes genéricos; el detalle va a los logs del servidor (`rpcMessage`) |
| 18 | Dependabot, audit, gitleaks, osv | Cumple | `npm audit`: 0 vulnerabilidades; osv-scanner sin incidencias; Dependabot semanal; CI con gitleaks y osv |
| 19 | HIBP por k-anonymity | Cumple | `src/lib/security/hibp.ts` (5 caracteres del SHA-1) al registrarse y al cambiar la contraseña |
| 20 | Fotos de tickets | Cumple | Magic bytes, 5 MB, recodificado sin EXIF, bucket privado, URL firmada |

Cabeceras (`next.config.ts`): CSP estricta (origen propio, Turnstile y el proyecto de Supabase), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`. Las cabeceras de producción en vivo no se han podido consultar en esta revisión: se leen del código.

## Captcha en las llamadas a Supabase Auth (Cloudflare Turnstile)

Con la clave anónima pública, cualquiera puede llamar a Auth directamente y saltarse un captcha que solo valide la app. Por eso el token viaja hasta Supabase y es **Supabase quien lo valida**:

- **Dónde se pide** (widget gestionado, modo «solo si hace falta», accesible): registro, entrar, recuperar contraseña, entrada de invitados, cambiar contraseña y borrar cuenta (estas dos reautentican con `signInWithPassword`).
- **Cómo viaja**: el formulario deja el token en `cf-turnstile-response`; la acción lo pasa como `options.captchaToken` a `signUp`, `signInWithPassword`, `resetPasswordForEmail` y `signInAnonymously` (`src/lib/security/captcha.ts`). El token es de un solo uso: la app no lo valida por su cuenta para no gastarlo antes que Supabase. Un test comprueba que todas esas llamadas lo llevan.
- **Si falta el token** y hay clave de sitio configurada, la acción se rechaza antes de llamar a Auth.
- **Activación en producción**: Supabase → Authentication → Attack Protection → *Enable Captcha protection* → proveedor Turnstile y su **clave secreta**. Hasta que se active, el token se ignora (siguen los límites de tasa). Si se usa `supabase config push`, la clave se lee de la variable `AUTH_CAPTCHA_SECRET` (nunca se escribe en el repositorio).
- **Local y CI**: en local el captcha de Auth está apagado para trabajar sin red. El CI lo enciende con la clave secreta de **prueba** de Cloudflare (acepta cualquier token) y compila la app con la clave de sitio de prueba, de modo que los e2e de registro, acceso e invitados pasan por el widget real.

## Excepciones documentadas

### E1. El navegador recibe el `access_token` para Realtime

**Qué es.** La lista de la compra compartida se actualiza en directo con Supabase Realtime. Realtime necesita un JWT en el navegador, pero las cookies de sesión son `httpOnly`, así que JavaScript no puede leerlas. Para suscribirse, la página pide el token a una acción del servidor (`realtimeAccess` en `src/server/actions/shopping.ts`).

**Por qué se acepta.** Sin este token no hay Realtime con RLS. La alternativa sin excepción es el sondeo periódico, que sigue activo como respaldo.

**Qué se ha limitado.**

| Control | Cómo |
|---|---|
| Qué se entrega | Solo el `access_token` (caduca en ≤ 1 h) y su fecha de caducidad. **Nunca el `refresh_token`.** |
| A quién | Solo a quien ya tiene sesión válida. Con rate limit (60 por hora y usuario/IP). |
| Dónde vive | Solo en memoria de la pestaña. Nada de `localStorage`, `sessionStorage`, IndexedDB ni cookies accesibles. El cliente se crea con `persistSession: false` y `autoRefreshToken: false`. |
| Caducidad | Se vuelve a pedir un minuto antes de caducar (o a los 5 s si el canal falla) y se cierra al salir de la pantalla. |
| Qué puede hacer | Lo mismo que la propia sesión de esa persona, sujeto a RLS. No es un permiso nuevo. |
| Dónde puede conectarse | La CSP solo permite `connect-src` hacia el origen HTTPS y el WebSocket (`wss://`) **de nuestro proyecto de Supabase**; el `ws:` genérico existe solo en desarrollo. |

**Riesgo residual.** Un fallo de XSS podría leer el token en memoria durante su vida (≤ 1 h). Lo mitigan la CSP (sin orígenes de terceros para conectar), no renderizar HTML con datos del usuario y la corta vida del token. El `refresh_token` no es accesible, así que no se puede prolongar la sesión.

**Comprobación automática.** `tests/unit/realtime-security.test.ts` falla si la acción devolviera el `refresh_token`, si el cliente usara almacenamiento del navegador, si dejara de renovar el token o si la CSP admitiera un WebSocket genérico.

## Pendiente (opcional): monitorización de errores con Sentry

No está instalada. Si algún día se activa, estas son las condiciones para no filtrar datos:

1. Crear un proyecto Next.js en Sentry (región UE) y guardar el DSN como variable `NEXT_PUBLIC_SENTRY_DSN` en Vercel.
2. Instalar el SDK (servidor y cliente) con `sendDefaultPii: false`.
3. `beforeSend` y `beforeBreadcrumb` que eliminen importes, conceptos, emails, nombres, tokens, cookies y cabeceras de autorización antes de enviar nada.
4. Sin *session replay* ni captura de entradas de formulario.
5. Ampliar la CSP (`connect-src`) solo con el host de ingestión del proyecto, nunca con comodines.
6. Probar con un error provocado que el evento llega sin datos personales.

## Cómo avisar de un problema

Escribe al responsable del repositorio por un canal privado antes de publicar nada.
