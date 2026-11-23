// Recorrido completo con la cuenta ficticia "Ana" (y un invitado "Marta" en una ventana de incógnito):
// gasto personal con Deshacer y favoritos, plan "Viaje Lisboa" con invitado, balance, cierre, resumen público,
// hogar con plan y regla de aportación, y gasto sin conexión.
//
// Requisitos: servidor en BASE_URL conectado a un Supabase LOCAL, y un archivo de sesión { session } de una cuenta ficticia.
// La entrada de invitados exige Turnstile: arranca el servidor con las claves de PRUEBA públicas de Cloudflare
// (TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA y NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA).
// Uso:  BASE_URL=http://localhost:3113 node scripts/e2e/walkthrough.mjs --session ruta/session.json
import fs from "node:fs";
import puppeteer from "puppeteer-core";
const sessionPath = process.argv[process.argv.indexOf("--session") + 1];
const { session } = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
const enc = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
const chunks = enc.match(/.{1,3000}/g);
const cookies = (chunks.length === 1 ? [[`sb-${process.env.SUPABASE_COOKIE_REF ?? "127"}-auth-token`, enc]] : chunks.map((c, i) => [`sb-${process.env.SUPABASE_COOKIE_REF ?? "127"}-auth-token.${i}`, c])).map(([name, value]) => ({ name, value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }));
const BASE = process.env.BASE_URL ?? "http://localhost:3113";
const fails = [], oks = [];
const ok = (m) => { oks.push(m); console.log("  OK  ", m); };
const fail = (m) => { fails.push(m); console.log("  FALLO", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.E2E_OUT ?? "/tmp/fifti-e2e";
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"], defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 } });
const page = await browser.newPage();
page.on("pageerror", (e) => fail("pageerror: " + e.message.slice(0, 120)));
await page.setCookie(...cookies, { name: "fifti_locale", value: "es", domain: "localhost", path: "/" });
const text = async () => page.evaluate(() => document.body.innerText);
const clickText = async (re, sel = "button, a, summary") => page.evaluate((src, s) => { const r = new RegExp(src, "i"); const el = [...document.querySelectorAll(s)].find((e) => r.test(e.textContent || "") || r.test(e.getAttribute("aria-label") || "")); if (el) { el.click(); return true; } return false; }, re.source, sel);
const typeAmount = async (str) => { for (const ch of str) await page.evaluate((c) => { const label = c === "," ? "Coma decimal" : c; const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.getAttribute("aria-label") === label); b?.click(); }, ch); };
const openSheet = async () => { await page.click('button[aria-haspopup="dialog"]'); await page.waitForSelector('[role=dialog][aria-label="Nuevo gasto"]', { timeout: 8000 }); };

// ── A. gasto personal + deshacer + favoritos + tooltip
console.log("A. Gasto personal");
await page.goto(BASE + "/inicio", { waitUntil: "networkidle0" });
const tipVisible = await page.evaluate(() => !!document.querySelector(".recharts-tooltip-wrapper") && getComputedStyle(document.querySelector(".recharts-tooltip-wrapper")).visibility === "visible" && !!document.querySelector(".recharts-tooltip-wrapper")?.textContent?.trim());
tipVisible ? fail("tooltip activo al cargar") : ok("sin tooltip activo al cargar");
const t0 = await text();
/2\.\d{3},\d{2}\s?€/.test(t0) ? ok("miles con punto en Inicio (" + (t0.match(/\d\.\d{3},\d{2}\s?€/) || [])[0] + ")") : fail("no se ve ningún importe con miles en Inicio");
await openSheet();
await page.type('input[aria-label="Concepto"]', "Café con Leo");
await typeAmount("12,5");
const out = await page.$eval("output", (o) => o.textContent);
out.includes("12,5") ? ok("teclado propio muestra 12,5") : fail("teclado: " + out);
await page.screenshot({ path: OUT + "/a-sheet.png" });
await clickText(/Guardar en Personal/);
await sleep(1500);
let t = await text();
/Guardado en Personal/.test(t) && /Deshacer/.test(t) ? ok("toast con Deshacer") : fail("sin toast/Deshacer: " + t.slice(-200));
await page.screenshot({ path: OUT + "/a-toast.png" });
await sleep(5600);
/Deshacer/.test(await text()) ? fail("el toast no desaparece en 5 s") : ok("el toast desaparece a los 5 s");
await page.goto(BASE + "/movimientos", { waitUntil: "networkidle0" });
/Café con Leo/.test(await text()) ? ok("el gasto aparece en Movimientos") : fail("gasto no aparece");
// deshacer real
await openSheet();
await page.type('input[aria-label="Concepto"]', "Gasto a deshacer");
await typeAmount("3");
await clickText(/Guardar en Personal/); await sleep(1200);
await clickText(/^Deshacer$/); await sleep(1500);
await page.goto(BASE + "/movimientos", { waitUntil: "networkidle0" });
/Gasto a deshacer/.test(await text()) ? fail("Deshacer no borró el gasto") : ok("Deshacer borra el gasto");
// favorito + pulsación larga
await page.goto(BASE + "/mas", { waitUntil: "networkidle0" });
await page.type('input[aria-label="Nombre"]', "Café"); await page.type('input[aria-label="Importe"]', "2,50");
await clickText(/Añadir favorito/); await sleep(1500);
await page.goto(BASE + "/inicio", { waitUntil: "networkidle0" });
const btn = await page.$('button[aria-haspopup="dialog"]'); const bb = await btn.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await sleep(800); await page.mouse.up(); await sleep(1200);
const favs = await text();
/Favoritos/.test(favs) && /Café/.test(favs) ? ok("pulsación larga abre Favoritos") : fail("favoritos no se abren");
await page.screenshot({ path: OUT + "/a-favs.png" });
await clickText(/^Café/); await sleep(800);
const prefill = await page.$eval('input[aria-label="Concepto"]', (i) => i.value).catch(() => "");
prefill === "Café" ? ok("el favorito rellena la hoja") : fail("favorito no rellena: " + prefill);
await clickText(/^Cerrar$/);

// ── B. Plan Viaje Lisboa con invitado en incógnito
console.log("B. Plan con invitado");
await page.goto(BASE + "/nueva", { waitUntil: "networkidle0" });
await page.type('input[name="name"]', "Viaje Lisboa E2E");
await page.select('select[name="template"]', "trip");
await clickText(/Crear burbuja/); await page.waitForFunction(() => location.pathname.startsWith("/espacio/"), { timeout: 10000 }).catch(() => {});
const spaceId = page.url().split("/espacio/")[1]?.split(/[/?]/)[0];
spaceId ? ok("plan creado " + spaceId.slice(0, 8)) : fail("no se creó el plan: " + page.url());
await page.select('select[aria-label="Tipo de enlace"]', "guest");
await clickText(/Crear enlace/); await sleep(1800);
const link = await page.$eval('input[aria-label="Enlace"]', (i) => i.value).catch(() => "");
link.includes("/unirse/") ? ok("enlace de invitado generado") : fail("sin enlace: " + link);
const hasQr = await page.evaluate(() => !!document.querySelector('svg[aria-label="Código QR del enlace"]'));
hasQr ? ok("QR visible") : fail("sin QR");
await page.evaluate(async (s) => { /* añade a Leo como miembro sin cuenta */ }, spaceId);
await page.type('input[aria-label="Nombre"]', "Leo"); await clickText(/^Añadir$/); await sleep(1500);
const ctx2 = await browser.createBrowserContext();
const guest = await ctx2.newPage();
await guest.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await guest.goto(link.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle0" });
await guest.screenshot({ path: OUT + "/b-guest-join.png" });
const gt = await guest.evaluate(() => document.body.innerText);
/Te han invitado/.test(gt) ? ok("invitado ve la invitación") : fail("página de invitado: " + gt.slice(0, 120));
await guest.type('input[name="name"]', "Marta");
await guest.waitForFunction(() => document.querySelector('input[name="cf-turnstile-response"]')?.value, { timeout: 20000 }).then(() => ok("Turnstile (clave de pruebas) emite token"), () => fail("Turnstile no emitió token"));
await guest.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Entrar al plan/.test(b.textContent))?.click());
await guest.waitForFunction(() => location.pathname === "/inicio", { timeout: 15000 }).catch(() => {});
guest.url().endsWith("/inicio") ? ok("invitado entra sin cuenta") : fail("invitado no entró: " + guest.url() + " " + (await guest.evaluate(() => document.body.innerText)).slice(0, 160));
// el invitado solo ve su grupo
const chips = await guest.evaluate(() => [...document.querySelectorAll('nav[aria-label="Burbujas"] button')].map((b) => b.textContent.trim()));
chips.length === 1 ? ok("invitado solo ve 1 burbuja: " + chips[0]) : fail("invitado ve burbujas: " + chips.join("|"));
const gSheet = async () => { await guest.click('button[aria-haspopup="dialog"]'); await guest.waitForSelector('[role=dialog][aria-label="Nuevo gasto"]'); };
await gSheet();
await guest.type('input[aria-label="Concepto"]', "Cena Alfama");
for (const ch of "86") await guest.evaluate((c) => [...document.querySelectorAll("[role=dialog] button")].find((x) => x.getAttribute("aria-label") === c)?.click(), ch);
await guest.screenshot({ path: OUT + "/b-guest-sheet.png" });
const share = await guest.evaluate(() => document.body.innerText.match(/Tu parte\s*([\d.,]+\s?€)/)?.[1]);
share ? ok("invitado ve 'Tu parte' en directo: " + share) : fail("sin Tu parte");
await guest.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Guardar en/.test(b.textContent))?.click()); await sleep(2000);
/Guardado en/.test(await guest.evaluate(() => document.body.innerText)) ? ok("invitado guarda un gasto") : fail("invitado no pudo guardar");
// Ana: balance y cierre
await page.setCookie({ name: "fifti_bubble", value: spaceId, domain: "localhost", path: "/" });
await page.goto(BASE + "/balance", { waitUntil: "networkidle0" });
const bal = await text();
/Cena Alfama|Marta/.test(bal) && /Balance de/.test(bal) ? ok("balance del plan con Marta") : fail("balance: " + bal.slice(0, 200));
await page.screenshot({ path: OUT + "/b-balance.png", fullPage: true });
await page.goto(`${BASE}/espacio/${spaceId}/cerrar`, { waitUntil: "networkidle0" });
await clickText(/Cerrar y archivar el plan/); await sleep(2500);
const closed = await text();
/Plan cerrado/.test(closed) && /Crear enlace de resumen/.test(closed) ? ok("plan cerrado y archivado (con opción de enlace de resumen)") : fail("cierre: " + closed.slice(0, 200));
await clickText(/Crear enlace de resumen/); await sleep(2000);
const sumLink = await page.$eval('input[aria-label="Enlace"]', (i) => i.value).catch(() => "");
sumLink.includes("/resumen/") ? ok("enlace de resumen público generado") : fail("sin enlace de resumen");
if (sumLink) { const pub = await browser.createBrowserContext(); const pp = await pub.newPage(); await pp.goto(sumLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle0" }); const pt2 = await pp.evaluate(() => document.body.innerText); /Viaje Lisboa E2E/.test(pt2) && /Quién paga a quién/.test(pt2) && !/Cena Alfama/.test(pt2) ? ok("resumen público sin sesión: sin conceptos de gastos") : fail("resumen público: " + pt2.slice(0, 160)); await pp.screenshot({ path: OUT + "/b-resumen-publico.png", fullPage: true }); await pub.close(); }
await page.screenshot({ path: OUT + "/b-cierre.png", fullPage: true });
await ctx2.close();

// ── C. Hogar con plan y regla de aportación
console.log("C. Hogar");
await page.goto(BASE + "/nueva", { waitUntil: "networkidle0" });
await page.evaluate(() => document.querySelector('input[name="kind"][value="household"]').click());
await page.type('input[name="name"]', "Casa E2E");
await clickText(/Crear burbuja/); await page.waitForFunction(() => location.pathname.startsWith("/espacio/"), { timeout: 10000 }).catch(() => {});
const hid = page.url().split("/espacio/")[1]?.split(/[/?]/)[0];
await page.type('input[aria-label="Nombre"]', "Leo"); await clickText(/^Añadir$/); await sleep(1500);
await page.setCookie({ name: "fifti_bubble", value: hid, domain: "localhost", path: "/" });
await page.goto(BASE + "/plan?vista=lista", { waitUntil: "networkidle0" });
await clickText(/Editar plan/, "summary"); await sleep(300);
const incInputs = await page.$$('input[name^="inc_"]'); let n = 0;
for (const i of incInputs) { await i.type(n++ === 0 ? "2100" : "1700"); }
const valInputs = await page.$$('input[name^="val_"]'); let k = 0;
for (const i of valInputs.slice(0, 3)) await i.type(["50", "30", "10"][k++]);
await clickText(/Guardar plan/); await sleep(2000);
const planT = await text();
/Plan guardado/.test(planT) || /3\.800,00/.test(planT) ? ok("plan del mes guardado") : fail("plan no guardado: " + planT.slice(0, 200));
await page.goto(BASE + "/plan?vista=lista", { waitUntil: "networkidle0" });
await clickText(/Regla de aportación/, "summary"); await sleep(300);
await page.type('input[aria-label="Bote mensual"]', "1200");
await clickText(/Guardar regla/); await sleep(1500);
await clickText(/Calcular aportaciones del mes/); await sleep(2000);
await page.goto(BASE + "/plan?vista=lista", { waitUntil: "networkidle0" });
const pt = await text();
/Bote común y aportaciones/.test(pt) && /\/\s*\d/.test(pt) ? ok("regla de aportación y aportaciones del mes calculadas") : fail("aportaciones: " + pt.slice(-300));
await page.screenshot({ path: OUT + "/c-plan.png", fullPage: true });
// marcar hecha → gasto en el plan personal
await clickText(/Marcar como hecha/); await sleep(2000);
await page.setCookie({ name: "fifti_bubble", value: "", domain: "localhost", path: "/", expires: 0 });
await page.goto(BASE + "/movimientos", { waitUntil: "networkidle0" });
/Aportación a Casa E2E/.test(await text()) ? ok("aportación hecha entra en el plan personal") : fail("aportación no refleja en personal");

// ── D. Sin conexión
console.log("D. Sin conexión");
await page.goto(BASE + "/inicio", { waitUntil: "networkidle0" });
await openSheet(); await clickText(/^Cerrar$/); await sleep(300); // calienta la caché local de la hoja
await page.setOfflineMode(true);
await openSheet();
await page.type('input[aria-label="Concepto"]', "Taxi sin cobertura");
await typeAmount("9,8");
await clickText(/Guardar en Personal/); await sleep(2000);
const off = await text();
/sin conexión/i.test(off) && /pendiente/i.test(off) ? ok("sin conexión: queda pendiente de subir") : fail("offline: " + off.slice(-250));
await page.screenshot({ path: OUT + "/d-offline.png" });
await page.setOfflineMode(false);
await page.evaluate(() => window.dispatchEvent(new Event("online")));
await sleep(5000);
await page.goto(BASE + "/movimientos", { waitUntil: "networkidle0" });
const mv = await text();
/Taxi sin cobertura/.test(mv) ? ok("al volver la conexión el gasto se sube solo") : fail("el gasto offline no llegó");
(mv.match(/Taxi sin cobertura/g) || []).length === 1 ? ok("sin duplicados") : fail("duplicado (¿ejecutaste el recorrido antes con la misma cuenta?)");
await browser.close();
console.log(`\nRESUMEN: ${oks.length} OK, ${fails.length} fallos`); fails.forEach((f) => console.log(" -", f));
process.exit(fails.length ? 1 : 0);
