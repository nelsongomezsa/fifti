// Mide el cambio de pestaña con latencia de red simulada (por defecto 300 ms por petición) en la demo.
// Uso:  LATENCY=300 node scripts/e2e/nav-latency.mjs
// Cada pestaña se mide dos veces: la primera visita y la vuelta (datos ya vistos).
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3113";
const LATENCY = Number(process.env.LATENCY ?? 300);
const host = new URL(BASE).hostname;
const TABS = [["/movimientos", "Movimientos"], ["/calendario", "Calendario"], ["/plan", "Plan"], ["/inicio", "Inicio"]];

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.setCookie({ name: "fifti_demo", value: "1", domain: host, path: "/" }, { name: "fifti_locale", value: "es", domain: host, path: "/" });
const cdp = await page.createCDPSession();
await cdp.send("Network.enable");
await page.goto(BASE + "/inicio", { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000)); // deja que acabe la precarga en reposo
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: LATENCY, downloadThroughput: -1, uploadThroughput: -1 });

// Tiempo hasta que la URL cambia y hasta que desaparece cualquier esqueleto (contenido real visible)
async function tap(href) {
  const t0 = Date.now();
  await page.evaluate((h) => document.querySelector(`nav[aria-label] a[href="${h}"]`)?.click(), href);
  await page.waitForFunction((h) => location.pathname === h, { timeout: 30000 }, href);
  const url = Date.now() - t0;
  await page.waitForFunction(() => !document.querySelector("main .animate-pulse, [data-skeleton]") && document.querySelector("main h1, main section"), { timeout: 30000 });
  return { url, content: Date.now() - t0 };
}

const DEEP = ["/inicio/prevision", "/inicio/ingresos", "/inicio/ahorro", "/movimientos"];
async function deep(href) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const t0 = Date.now();
  const ok = await page.evaluate((h) => { const a = document.querySelector(`main a[href="${h}"]`); a?.click(); return !!a; }, href);
  if (!ok) return null;
  await page.waitForFunction((h) => location.pathname === h, { timeout: 30000 }, href);
  const url = Date.now() - t0;
  await page.waitForFunction(() => !document.querySelector("main .animate-pulse, [data-skeleton], [aria-busy=true]"), { timeout: 30000 });
  const content = Date.now() - t0;
  await page.goBack(); await page.waitForFunction(() => location.pathname === "/inicio", { timeout: 30000 });
  return { url, content };
}
const rows = [];
for (const round of ["1.ª visita", "vuelta", "tras 40 s"]) {
  if (round === "tras 40 s") await new Promise((q) => setTimeout(q, 40000)); // la caché de cliente ya habría caducado en la configuración por defecto
  for (const [href, name] of TABS) {
    const r = await tap(href);
    rows.push({ pestaña: name, ronda: round, "URL (ms)": r.url, "contenido (ms)": r.content });
    await new Promise((q) => setTimeout(q, 1500));
  }
}
await tap("/inicio");
for (const href of DEEP.filter((h) => h !== "/movimientos")) {
  const r = await deep(href);
  if (r) rows.push({ pestaña: href, ronda: "detalle desde Inicio", "URL (ms)": r.url, "contenido (ms)": r.content });
  await new Promise((q) => setTimeout(q, 1500));
}
console.log(`Latencia simulada: ${LATENCY} ms por petición`);
console.table(rows);
const avg = (rn) => { const l = rows.filter((r) => r.ronda === rn); return l.length ? Math.round(l.reduce((a, r) => a + r["contenido (ms)"], 0) / l.length) : 0; };
const _unused = (rn) => Math.round(rows.filter((r) => r.ronda === rn).reduce((a, r) => a + r["contenido (ms)"], 0) / TABS.length);
console.log(`Media contenido visible: 1.ª visita ${avg("1.ª visita")} ms · vuelta ${avg("vuelta")} ms · tras 40 s ${avg("tras 40 s")} ms · detalle ${avg("detalle desde Inicio")} ms`);
await browser.close();
