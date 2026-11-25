// Recorre todas las pantallas de la demo (es y en) y falla si alguna da error HTTP o enseña textos rotos.
// Uso:  BASE_URL=https://… node scripts/e2e/demo-sweep.mjs
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3113";
const host = new URL(BASE).hostname;
const src = fs.readFileSync("scripts/e2e/overflow.mjs", "utf8");
const AUTH = JSON.parse(src.match(/const AUTH = (\[.*?\]);/s)[1]);
const extra = ["/inicio/ingresos", "/inicio/prevision", "/inicio/ahorro", "/movimientos?mes=2026-10", "/balance", "/nueva", "/csv", "/ahorro", "/mas", "/calendario?mes=2026-12", "/plan?vista=lista"];
const bad = /undefined|NaN|\[object|This page couldn|Application error|\bnav\.|\bhome\.|\bmore\.|Burbuja|Fondos?\b/;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
let fails = 0;
for (const loc of ["es", "en"]) {
  for (const r of [...new Set([...AUTH, ...extra])]) {
    const p = await browser.newPage();
    await p.setViewport({ width: 390, height: 844, isMobile: true });
    await p.setCookie({ name: "fifti_demo", value: "1", domain: host, path: "/" }, { name: "fifti_locale", value: loc, domain: host, path: "/" });
    try {
      const res = await p.goto(BASE + r, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((q) => setTimeout(q, 400));
      const txt = await p.evaluate(() => document.body.innerText);
      const m = txt.match(bad);
      const st = res?.status() ?? 0;
      if (st >= 400 || m) { fails++; console.log("FALLO", loc, r, st, m?.[0] ?? ""); }
    } catch (e) { fails++; console.log("ERROR", loc, r, String(e.message).slice(0, 80)); }
    await p.close();
  }
}
await browser.close();
console.log(fails ? `${fails} fallos` : "demo sin textos ni pantallas rotas");
process.exit(fails ? 1 : 0);
