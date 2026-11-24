// Paridad demo / cuenta real: en cada ruta deben existir los mismos elementos tocables (enlaces y botones),
// porque la demo monta las mismas páginas con un proveedor de datos en memoria.
// Uso:  BASE_URL=https://… node scripts/e2e/parity.mjs --cookies ruta/cookies.json
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3113";
const cookiesPath = process.argv[process.argv.indexOf("--cookies") + 1];
const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
const ROUTES = ["/inicio", "/movimientos", "/plan", "/plan?vista=lista", "/ahorro", "/mas", "/calendario", "/calendario?vista=proximos", "/tendencias", "/resumen-mensual", "/prestamos", "/reglas", "/csv", "/atajo", "/compra", "/balance", "/inicio/ingresos", "/inicio/ahorro", "/inicio/prevision"];
// Elementos que dependen de los datos concretos o que solo tienen sentido en uno de los dos modos
const IGNORE = /^(a:\/movimientos\/:id|a:\/ahorro\/:id|a:\/inicio\/fondo\/:id|a:\/espacio\/:id.*|a:\/demo\/salir|a:\/registro|b:(Salir|Salir de la demo|Crear cuenta|Cerrar sesión|Borrar mi cuenta|Cambiar contraseña|Guardar contraseña)$)/;

const norm = (s) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id").replace(/\?.*$/, "");
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
const host = new URL(BASE).hostname;

async function collect(mode) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.setCookie({ name: "fifti_locale", value: "es", domain: host, path: "/" });
  if (mode === "real") await page.setCookie(...cookies.map((c) => ({ ...c, domain: host })));
  else await page.goto(BASE + "/demo", { waitUntil: "networkidle2" });
  const out = {};
  for (const r of ROUTES) {
    await page.goto(BASE + r, { waitUntil: "networkidle2", timeout: 30000 });
    out[r] = await page.evaluate(() => {
      const set = new Set();
      for (const a of document.querySelectorAll("a[href^='/']")) set.add("a:" + a.getAttribute("href"));
      for (const b of document.querySelectorAll("button")) set.add("b:" + (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 40));
      return [...set];
    });
  }
  await page.close();
  return out;
}
const real = await collect("real"), demo = await collect("demo");
await browser.close();
let fails = 0;
for (const r of ROUTES) {
  const a = new Set(real[r].map(norm).filter((k) => !IGNORE.test(k)).filter((k) => !/^b:\d|^b:$/.test(k)));
  const b = new Set(demo[r].map(norm).filter((k) => !IGNORE.test(k)).filter((k) => !/^b:\d|^b:$/.test(k)));
  const onlyReal = [...a].filter((k) => !b.has(k)), onlyDemo = [...b].filter((k) => !a.has(k));
  if (onlyReal.length || onlyDemo.length) { fails++; console.log(`DIFERENCIAS ${r}\n   solo real: ${JSON.stringify(onlyReal)}\n   solo demo: ${JSON.stringify(onlyDemo)}`); }
  else console.log(`  OK   ${r} (${a.size} elementos tocables)`);
}
console.log(fails ? `\n${fails} ruta(s) con diferencias` : "\nParidad total.");
process.exit(fails ? 1 : 0);
