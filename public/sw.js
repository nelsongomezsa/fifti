/* Service worker de Fifti: shell offline, estáticos en caché y lectura offline de las páginas ya visitadas.
   Nunca intercepta POST (server actions, escrituras) ni guarda páginas con tokens en la URL. */
const VERSION = "v1";
const STATIC = `fifti-static-${VERSION}`;
const PAGES = `fifti-pages-${VERSION}`;
const PRECACHE = ["/offline", "/icons/icon-192.png", "/icons/icon-512.png", "/brand/logo-dark.svg"];
const NEVER_CACHE = ["/auth/", "/unirse/", "/reclamar/", "/resumen/", "/login", "/registro", "/recuperar", "/restablecer"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, PAGES].includes(k)).map((k) => caches.delete(k))))
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

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

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
