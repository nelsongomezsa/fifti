// Comprueba que el botón "Guardar en [burbuja]" y la línea "Tu parte" quedan dentro de la pantalla (375×812)
// en la hoja "Nuevo gasto" de la DEMO y de la app REAL, en las tres burbujas y en modo claro y oscuro.
//
// Uso:  BASE_URL=http://localhost:3113 node scripts/e2e/sheet-fits.mjs [--session ruta/session.json]
// Sin --session solo prueba la demo. El archivo de sesión es { session, ids } de una cuenta ficticia local.
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3113";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sessionPath = process.argv.includes("--session") ? process.argv[process.argv.indexOf("--session") + 1] : null;
const W = 375, H = 812;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authCookies(file) {
  const { session } = JSON.parse(fs.readFileSync(file, "utf8"));
  const enc = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const chunks = enc.match(/.{1,3000}/g);
  const host = new URL(process.env.SUPABASE_COOKIE_REF ? `http://${process.env.SUPABASE_COOKIE_REF}` : "http://127.0.0.1").hostname.split(".")[0];
  return (chunks.length === 1 ? [[`sb-${host}-auth-token`, enc]] : chunks.map((c, i) => [`sb-${host}-auth-token.${i}`, c]))
    .map(([name, value]) => ({ name, value, domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax" }));
}

/** Mide, dentro del diálogo abierto, el botón Guardar y la línea "Tu parte" para la burbuja ya elegida. */
const measure = (page) => page.evaluate(() => {
  const dlg = document.querySelector('[role=dialog]');
  const btn = [...dlg.querySelectorAll("button")].find((b) => /^Guardar en/.test(b.textContent.trim()));
  const part = [...dlg.querySelectorAll("p")].find((p) => /^Tu parte/.test(p.textContent.trim()));
  const r = btn.getBoundingClientRect(), t = part.getBoundingClientRect();
  return { label: btn.textContent.trim(), btnTop: Math.round(r.top), btnBottom: Math.round(r.bottom), partBottom: Math.round(t.bottom), vh: innerHeight };
});

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"], defaultViewport: { width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
const rows = [];
let failed = 0;

for (const theme of ["light", "dark"]) {
  for (const target of sessionPath ? ["demo", "real"] : ["demo"]) {
    const page = await browser.newPage();
    await page.setCookie({ name: "fifti_theme", value: theme, domain: new URL(BASE).hostname, path: "/" });
    if (target === "real") await page.setCookie(...authCookies(sessionPath));
    if (target === "demo") {
      await page.goto(`${BASE}/demo`, { waitUntil: "networkidle0" });
      await page.click(`[aria-label="Añadir gasto"]`);
    } else {
      await page.goto(`${BASE}/inicio?nuevo=gasto`, { waitUntil: "networkidle0" });
    }
    await page.waitForSelector("[role=dialog]");
    const chipCount = await page.evaluate(() => document.querySelector("[role=dialog] .overflow-x-auto").querySelectorAll("button").length);
    for (let i = 0; i < chipCount; i++) {
      await page.evaluate((idx) => document.querySelector("[role=dialog] .overflow-x-auto").querySelectorAll("button")[idx].click(), i);
      await sleep(250);
      const m = await measure(page);
      const ok = m.btnTop >= 0 && m.btnBottom <= m.vh && m.partBottom <= m.btnTop;
      if (!ok) failed++;
      rows.push(`${ok ? "OK   " : "FALLO"} ${theme.padEnd(5)} ${target.padEnd(4)} ${m.label.slice(0, 34).padEnd(34)} guardar ${m.btnTop}-${m.btnBottom} de ${m.vh}`);
    }
    await page.close();
  }
}
await browser.close();
console.log(rows.join("\n"));
console.log(failed ? `\n${failed} comprobaciones fallidas` : `\nTodo dentro de ${H}px`);
process.exit(failed ? 1 : 0);
