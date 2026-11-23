import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { serviceWorkerSource } from "@/lib/sw-source";

type Handler = (e: Record<string, unknown>) => void;

/** Simula un navegador mínimo: CacheStorage en memoria, fetch simulado y los eventos del service worker. */
function harness(version: string, existingCaches: Record<string, Record<string, Response>> = {}, network: (url: string, init?: { method?: string }) => Response | Promise<Response> = () => new Response("", { status: 500 })) {
  const store = new Map<string, Map<string, Response>>(Object.entries(existingCaches).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const handlers: Record<string, Handler> = {};
  const fetched: string[] = [];
  const mkCache = (name: string) => ({
    put: async (r: Request | string, res: Response) => { (store.get(name) ?? store.set(name, new Map()).get(name)!).set(typeof r === "string" ? r : r.url, res); },
    match: async (r: Request | string) => store.get(name)?.get(typeof r === "string" ? r : r.url)?.clone(),
    addAll: async (urls: string[]) => { for (const u of urls) await mkCache(name).put("https://app.test" + u, await doFetch("https://app.test" + u)); },
  });
  const doFetch = async (input: Request | string, init?: { method?: string }) => {
    const url = typeof input === "string" ? input : input.url;
    fetched.push(url);
    return network(url, init);
  };
  const caches = {
    open: async (n: string) => { if (!store.has(n)) store.set(n, new Map()); return mkCache(n); },
    keys: async () => [...store.keys()],
    delete: async (n: string) => store.delete(n),
    match: async (r: Request | string) => { const u = typeof r === "string" ? r : r.url; for (const m of store.values()) { const h = m.get(u) ?? m.get("https://app.test" + u); if (h) return h.clone(); } return undefined; },
  };
  const self = { location: { origin: "https://app.test" }, addEventListener: (t: string, h: Handler) => { handlers[t] = h; }, skipWaiting: async () => undefined, clients: { claim: async () => undefined } };
  vm.runInNewContext(serviceWorkerSource(version), { self, caches, fetch: doFetch, Response, URL, Promise, JSON, console });

  const run = async (type: string, extra: Record<string, unknown> = {}) => {
    let waited: Promise<unknown> = Promise.resolve(); let responded: Promise<Response> | undefined;
    handlers[type]!({ ...extra, waitUntil: (p: Promise<unknown>) => { waited = p; }, respondWith: (p: Promise<Response>) => { responded = Promise.resolve(p); } });
    await waited;
    return responded ? await responded : undefined;
  };
  const req = (url: string, mode: "navigate" | "cors" = "cors", method = "GET") => ({ url: "https://app.test" + url, method, mode });
  return { store, fetched, run, req, handlers };
}

const html = (t: string) => new Response(t, { status: 200, headers: { "content-type": "text/html" } });
const css = () => new Response("a{}", { status: 200, headers: { "content-type": "text/css" } });

describe("service worker: seguro tras un despliegue nuevo", () => {
  it("las cachés llevan la versión en el nombre", async () => {
    const h = harness("abc123", {}, (u) => (u.endsWith("/offline") ? html("offline") : css()));
    await h.run("install");
    expect([...h.store.keys()]).toEqual(["fifti-static-abc123"]);
  });

  it("en 'activate' borra las cachés de versiones anteriores y conserva las actuales", async () => {
    const h = harness("v2", { "fifti-static-v1": { x: css() }, "fifti-pages-v1": { x: html("viejo") }, "fifti-static-v2": { y: css() }, "otra-cosa": {} });
    await h.run("activate");
    expect([...h.store.keys()].sort()).toEqual(["fifti-static-v2"]);
  });

  it("la versión se inyecta como literal seguro (sin romper el script)", () => {
    expect(() => new vm.Script(serviceWorkerSource('x"; evil(); //'))).not.toThrow();
    expect(serviceWorkerSource("1.2-ab")).toContain('const VERSION = "1.2-ab";');
  });

  it("navegaciones: la red tiene prioridad aunque haya una copia en caché", async () => {
    const h = harness("v1", { "fifti-pages-v1": { "https://app.test/plan": html("HTML VIEJO con chunks que ya no existen") } }, () => html("HTML NUEVO"));
    const res = await h.run("fetch", { request: h.req("/plan", "navigate") });
    expect(await res!.text()).toBe("HTML NUEVO");
    expect(h.fetched).toContain("https://app.test/plan");
  });

  it("navegaciones: solo usa la copia si no hay red", async () => {
    const h = harness("v1", { "fifti-pages-v1": { "https://app.test/plan": html("copia") }, "fifti-static-v1": { "https://app.test/offline": html("sin conexión") } }, () => { throw new TypeError("offline"); });
    expect(await (await h.run("fetch", { request: h.req("/plan", "navigate") }))!.text()).toBe("copia");
    expect(await (await h.run("fetch", { request: h.req("/inicio", "navigate") }))!.text()).toBe("sin conexión");
  });

  it("assets con hash de /_next/static: cache-first y se guardan; el HTML y los errores no", async () => {
    let n = 0;
    const h = harness("v1", {}, () => { n++; return css(); });
    const url = "/_next/static/chunks/1-y19rrm6zoh9.css";
    expect(await (await h.run("fetch", { request: h.req(url) }))!.text()).toBe("a{}");
    expect(await (await h.run("fetch", { request: h.req(url) }))!.text()).toBe("a{}");
    expect(n).toBe(1); // la segunda vez salió de la caché

    // tras un despliegue el archivo ya no existe: el servidor responde 404 text/plain y NO se cachea ni se sirve como estilo
    const h2 = harness("v2", {}, () => new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } }));
    const res = await h2.run("fetch", { request: h2.req(url) });
    expect(res!.status).toBe(404);
    expect(h2.store.get("fifti-static-v2")?.size ?? 0).toBe(0);
    // y una respuesta 200 con tipo HTML o text/plain en una ruta de estáticos tampoco se guarda
    const h3 = harness("v3", {}, () => html("página de error"));
    await h3.run("fetch", { request: h3.req(url) });
    expect(h3.store.get("fifti-static-v3")?.size ?? 0).toBe(0);
  });

  it("no cachea nada que no sea HTML de navegación o asset con hash", async () => {
    const h = harness("v1", {}, () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    for (const r of [h.req("/icons/icon-192.png"), h.req("/brand/logo-dark.svg"), h.req("/api/export?space=x"), h.req("/plan", "cors")]) {
      expect(await h.run("fetch", { request: r })).toBeUndefined(); // no intercepta: lo gestiona el navegador
    }
    expect(h.store.size).toBe(0);
  });

  it("no intercepta POST (server actions) ni otros orígenes", async () => {
    const h = harness("v1");
    expect(await h.run("fetch", { request: h.req("/plan", "navigate", "POST") })).toBeUndefined();
    expect(await h.run("fetch", { request: { url: "https://otro.test/_next/static/a.js", method: "GET", mode: "cors" } })).toBeUndefined();
  });

  it("nunca guarda páginas con tokens en la URL ni de autenticación", async () => {
    const h = harness("v1", {}, () => html("secreto"));
    for (const p of ["/unirse/TOKEN", "/reclamar/TOKEN", "/resumen/TOKEN", "/login", "/auth/callback", "/api/export"]) await h.run("fetch", { request: h.req(p, "navigate") });
    expect(h.store.get("fifti-pages-v1")?.size ?? 0).toBe(0);
  });

  it("'clear' (al cerrar sesión) borra las páginas guardadas", async () => {
    const h = harness("v1", { "fifti-pages-v1": { a: html("x") } });
    await h.run("message", { data: "clear" });
    expect(h.store.has("fifti-pages-v1")).toBe(false);
  });

  it("cada versión produce un script distinto (el navegador lo detecta como actualización)", () => {
    expect(serviceWorkerSource("a")).not.toBe(serviceWorkerSource("b"));
  });
});
