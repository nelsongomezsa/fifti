# Seguridad de Fifti

Resumen de las medidas del proyecto y de las excepciones que se han tomado a propósito.

## Medidas generales

- RLS activada y forzada en todas las tablas, con tests contra una base de datos real.
- Validación en el servidor con Zod `.strict()` en cada acción; nada se confía a lo que envía el cliente.
- Sesión en cookies `httpOnly` (`@supabase/ssr`); sin `service_role` en el frontend.
- Rate limiting por IP y por usuario en las acciones sensibles; comprobación de contraseñas filtradas (HIBP).
- Cabeceras de seguridad y CSP estricta (`next.config.ts`).
- Dinero en céntimos enteros; porcentajes en puntos básicos.

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

## Cómo avisar de un problema

Escribe al responsable del repositorio por un canal privado antes de publicar nada.
