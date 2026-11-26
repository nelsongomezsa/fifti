/**
 * Código del service worker. Se genera con la versión del despliegue (`version`), de modo que cada despliegue cambia
 * los bytes de /sw.js: el navegador instala el nuevo, y al activarse borra todas las cachés de versiones anteriores.
 *
 * Reglas (verificadas en tests/unit/service-worker.test.ts):
 * - Navegaciones (HTML): a la red primero (network-first); la caché solo se usa si no hay red.
 *   Excepción: las pantallas de la barra (/inicio, /movimientos, /calendario, /plan) salen al instante de la caché y se revalidan por detrás.
 * - Solo se cachean con política cache-first los assets con hash de /_next/static (y solo respuestas 200 que no sean HTML).
 * - Nada más se cachea: ni iconos sin hash, ni peticiones /api, ni POST (server actions), ni otros orígenes.
 * - Nunca se guardan páginas con tokens en la URL ni de autenticación.
 * - Las cachés llevan la versión en el nombre y en `activate` se eliminan las que no son de esta versión.
 */
export function serviceWorkerSource(version: string): string {
  return `/* Fifti service worker · versión ${version.replace(/[^\w.-]/g, "")} */
const VERSION = ${JSON.stringify(version)};
const STATIC = "fifti-static-" + VERSION;
const PAGES = "fifti-pages-" + VERSION;
const PRECACHE = ["/offline"];
// Pantallas de la barra: al abrir la app se sirve al instante la última copia guardada (stale-while-revalidate) y se pide la nueva por detrás
const SHELL = ["/inicio", "/movimientos", "/calendario", "/plan"];
const NEVER_CACHE = ["/auth/", "/unirse/", "/reclamar/", "/resumen/", "/login", "/registro", "/recuperar", "/restablecer", "/api/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Al cerrar sesión se borra todo lo guardado en el dispositivo
self.addEventListener("message", (event) => {
  if (event.data === "clear") event.waitUntil(caches.delete(PAGES));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Assets con hash: cache-first. Si el archivo ya no existe (despliegue nuevo) la respuesta de error pasa tal cual y no se guarda.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const type = res.headers.get("content-type") || "";
        if (res.status === 200 && !type.includes("text/html") && !type.includes("text/plain")) {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
    return;
  }

  if (req.mode === "navigate") {
    const cacheable = !NEVER_CACHE.some((p) => url.pathname.startsWith(p));
    // Pantallas de la barra: copia guardada al instante + revalidación por detrás; al llegar la nueva se avisa a la página para que se refresque
    if (cacheable && SHELL.includes(url.pathname)) {
      const update = fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); }
          return res;
        });
      event.respondWith(
        caches.match(req).then((hit) => {
          if (hit) {
            event.waitUntil(update.then(async () => {
              try { const c = event.resultingClientId && (await self.clients.get(event.resultingClientId)); if (c) c.postMessage({ type: "fifti-updated", path: url.pathname }); } catch { /* sin cliente */ }
            }).catch(() => undefined));
            return hit;
          }
          return update.catch(async () => (await caches.match("/offline")) || Response.error());
        }),
      );
      return;
    }
    // Resto del HTML: red primero; la caché solo como respaldo sin conexión.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (cacheable && res.ok && !res.redirected) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(async () => (cacheable && (await caches.match(req))) || (await caches.match("/offline")) || Response.error()),
    );
  }
});

// Notificaciones push: texto genérico (sin importes); al pulsar se abre una ruta interna de la app.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* sin datos */ }
  const title = typeof data.title === "string" ? data.title.slice(0, 80) : "Fifti";
  const body = typeof data.body === "string" ? data.body.slice(0, 160) : "";
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/inicio";
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/icons/icon-192.png", badge: "/favicon-32.png", data: { url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/inicio";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
`;
}
