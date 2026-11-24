// Falla si alguna pantalla desborda en horizontal a 390 px (scrollWidth > innerWidth), en oscuro y en claro, con sesión y en la demo.
// Uso:  BASE_URL=https://… node scripts/e2e/overflow.mjs --cookies ruta/cookies.json
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3113";
const cookiesPath = process.argv[process.argv.indexOf("--cookies") + 1];
const cookies = cookiesPath && fs.existsSync(cookiesPath) ? JSON.parse(fs.readFileSync(cookiesPath, "utf8")) : [];
const AUTH = ["/inicio", "/movimientos", "/plan", "/plan?vista=fijos", "/plan?vista=ahorro", "/ajustes", "/fijos/nuevo", "/calendario?vista=proximos", "/calendario", "/calendario?vista=proximos", "/tendencias", "/resumen-mensual", "/prestamos", "/reglas", "/csv", "/atajo", "/compra", "/balance", "/inicio/ingresos", "/inicio/ahorro", "/inicio/prevision"];
const PUBLIC = ["/", "/demo", "/login", "/registro", "/recuperar"];
const fails = [];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
const host = new URL(BASE).hostname;
for (const theme of ["dark", "light"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const base = [{ name: "fifti_locale", value: "es", domain: host, path: "/" }, { name: "fifti_theme", value: theme, domain: host, path: "/" }];
  for (const [label, routes, withSession] of [["público", PUBLIC, false], ["con sesión", AUTH, true]]) {
    if (withSession && cookies.length === 0) continue;
    await page.deleteCookie(...(await page.cookies()));
    await page.setCookie(...base, ...(withSession ? cookies.map((c) => ({ ...c, domain: host })) : []));
    for (const r of routes) {
      // Un reintento ante un tiempo agotado: con varias pruebas a la vez el servidor puede tardar más de 30 s en quedar en reposo
      let loaded = false;
      for (let intento = 0; intento < 2 && !loaded; intento++) {
        try { await page.goto(BASE + r, { waitUntil: "networkidle2", timeout: 45000 }); loaded = true; } catch { /* se reintenta */ }
      }
      if (!loaded) { fails.push(`${r} (${theme}): no cargó`); continue; }
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
      if (m.sw > m.iw) fails.push(`${r} (${theme}, ${label}): scrollWidth ${m.sw} > ${m.iw}`);
      else console.log("  OK  ", r, theme);
    }
  }
  await page.close();
}
await browser.close();
if (fails.length) { console.log("\nFALLOS:\n" + fails.join("\n")); process.exit(1); }
console.log("\nSin desbordes.");
