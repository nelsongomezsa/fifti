// Prueba de punta a punta de /nuevo (atajo de Siri) con sesión y sin ella.
// Uso:  BASE_URL=https://… node scripts/e2e/quick-new.mjs --cookies ruta/cookies.json
// cookies.json = lista de cookies de sesión de una cuenta ficticia en formato puppeteer ({name, value, domain, path, ...}).
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3113";
const cookiesPath = process.argv[process.argv.indexOf("--cookies") + 1];
const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
const fails = [];
const ok = (m) => console.log("  OK  ", m);
const fail = (m) => { fails.push(m); console.log("  FALLO", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
const SHEET = '[role=dialog][aria-label="Nuevo gasto"]';

async function fresh(withSession) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  const host = new URL(BASE).hostname;
  if (withSession) await page.setCookie(...cookies.map((c) => ({ ...c, domain: host })), { name: "fifti_locale", value: "es", domain: host, path: "/" });
  return { page, errors, close: () => ctx.close() };
}

// 1. Con sesión y parámetros válidos, incluso con un contexto guardado ANTIGUO (sin reglas) en el dispositivo
console.log("1. /nuevo con sesión y parámetros válidos");
{
  const { page, errors, close } = await fresh(true);
  await page.goto(BASE + "/mas", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("fifti:sheetCtx", JSON.stringify({ spaces: [{ id: "x", name: "Viejo", kind: "personal", currency: "EUR", meId: "m", members: [], categories: [], topCategoryId: null }], favorites: [] })));
  await page.goto(BASE + "/nuevo?importe=12,50&concepto=Caf%C3%A9&burbuja=personal", { waitUntil: "networkidle0" });
  try { await page.waitForSelector(SHEET, { timeout: 15000 }); ok("la hoja se abre"); } catch { fail("la hoja no se abrió"); }
  const body = await page.evaluate(() => document.body.innerText);
  /couldn.t load|Application error/i.test(body) ? fail("pantalla de error") : ok("sin pantalla de error");
  const out = await page.evaluate(() => document.querySelector("output")?.textContent ?? "");
  /12,50/.test(out) ? ok("importe rellenado: " + out.trim()) : fail("importe no rellenado: " + out);
  const desc = await page.evaluate(() => document.querySelector('input[aria-label="Concepto"]')?.value ?? "");
  desc === "Café" ? ok("concepto rellenado") : fail("concepto: " + desc);
  const saved = await page.evaluate(() => document.querySelectorAll("[role=status]").length);
  saved === 0 ? ok("no se guardó nada solo") : fail("apareció un aviso de guardado");
  errors.length ? fail("errores de página: " + errors.join(" | ")) : ok("sin errores de página");
  await close();
}

// 2. Parámetros inválidos: la hoja se abre vacía y no ejecuta nada
console.log("2. /nuevo con parámetros inválidos");
{
  const { page, errors, close } = await fresh(true);
  const q = new URLSearchParams({ importe: "abc", concepto: "x".repeat(200), burbuja: "<script>alert(1)</script>", categoria: "../../etc", extra: "1" });
  await page.goto(BASE + "/nuevo?" + q.toString(), { waitUntil: "networkidle0" });
  try { await page.waitForSelector(SHEET, { timeout: 15000 }); ok("la hoja se abre igualmente"); } catch { fail("la hoja no se abrió"); }
  const out = await page.evaluate(() => document.querySelector("output")?.textContent ?? "");
  /^\s*0\s/.test(out) ? ok("importe vacío") : fail("importe inesperado: " + out);
  const desc = await page.evaluate(() => document.querySelector('input[aria-label="Concepto"]')?.value ?? "");
  desc === "" ? ok("concepto vacío (demasiado largo)") : fail("concepto inesperado: " + desc.slice(0, 30));
  const injected = await page.evaluate(() => !!document.querySelector("script:not([src])") && document.body.innerHTML.includes("<script>alert"));
  injected ? fail("HTML inyectado") : ok("nada inyectado");
  errors.length ? fail("errores de página: " + errors.join(" | ")) : ok("sin errores de página");
  await close();
}

// 3. Sin sesión: pasa por el login y conserva la vuelta
console.log("3. /nuevo sin sesión");
{
  const { page, close } = await fresh(false);
  await page.goto(BASE + "/nuevo?importe=5&concepto=Caf%C3%A9", { waitUntil: "domcontentloaded" });
  const url = new URL(page.url());
  url.pathname === "/login" ? ok("redirige a /login") : fail("no redirige: " + url.pathname);
  const next = url.searchParams.get("next") ?? "";
  next.startsWith("/nuevo?importe=5") ? ok("conserva la vuelta (next)") : fail("next = " + next);
  await close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} fallo(s)` : "\nTodo OK");
process.exit(fails.length ? 1 : 0);
