/**
 * Código del service worker. Se genera con la versión del despliegue (`version`), de modo que cada despliegue cambia
 * los bytes de /sw.js: el navegador instala el nuevo, y al activarse borra todas las cachés de versiones anteriores.
 *
 * Reglas (verificadas en tests/unit/service-worker.test.ts):
 * - Navegaciones (HTML): SIEMPRE a la red primero (network-first). La caché solo se usa si no hay red.
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

  // HTML: red primero; la caché solo como respaldo sin conexión.
  if (req.mode === "navigate") {
    const cacheable = !NEVER_CACHE.some((p) => url.pathname.startsWith(p));
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
