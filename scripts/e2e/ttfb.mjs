// TTFB de cada pantalla (demo) en la 1.ª petición y en la 2.ª. Justo después de un despliegue, la 1.ª es en frío.
// Uso:  BASE_URL=https://… node scripts/e2e/ttfb.mjs
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "https://fifti-seven.vercel.app";
const host = new URL(BASE).hostname;
const ROUTES = ["/inicio", "/plan", "/calendario", "/movimientos", "/cuentas", "/ajustes", "/login"];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const rows = [];
for (const r of ROUTES) {
  const res = {};
  for (const round of ["1.ª (frío tras desplegar)", "2.ª (caliente)"]) {
    const page = await browser.newPage();
    await page.setCookie({ name: "fifti_demo", value: "1", domain: host, path: "/" });
    const resp = await page.goto(BASE + r, { waitUntil: "load", timeout: 60000 });
    const t = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { ttfb: Math.round(n.responseStart - n.requestStart), total: Math.round(n.responseEnd - n.requestStart) }; });
    const st = resp?.headers()["server-timing"] ?? "";
    res[round] = `${t.ttfb} ms`;
    if (round.startsWith("1")) res["server-timing"] = st.slice(0, 50);
    await page.close();
  }
  rows.push({ ruta: r, ...res });
}
await browser.close();
console.table(rows);
