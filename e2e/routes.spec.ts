import { expect, test } from "@playwright/test";
import { e2eConfigured, login, newUser, personalOf, removeUsers, seedExpense, seedPlan, type TestUser } from "./helpers";

// Barrido de TODAS las pantallas con una sesión REAL (no la demo) y datos de cuentas, hogar, gasto fijo y meta.
// Falla ante una página de error, un error de React en consola, un estado HTTP de error o un desborde horizontal.
// Se ejecuta antes de cada despliegue (npm run deploy).
test.skip(!e2eConfigured, "Faltan las claves de pruebas");

const ROUTES = [
  "/inicio", "/inicio/ahorro", "/inicio/ingresos", "/inicio/prevision", "/movimientos", "/movimientos?tipo=ingresos", "/movimientos?tipo=traspasos",
  "/calendario", "/calendario?vista=proximos", "/calendario?mes=2026-12", "/plan", "/plan?vista=fijos", "/plan?vista=ahorro", "/fijos/nuevo",
  "/ajustes", "/mas", "/cuentas", "/traspaso", "/aportar", "/balance", "/nueva", "/csv", "/compra", "/prestamos", "/reglas", "/atajo",
  "/tendencias", "/resumen-mensual", "/tu-ano", "/ahorro",
];

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

test("todas las pantallas cargan con sesión real, sin errores ni desbordes", async ({ page }) => {
  test.setTimeout(240_000);
  const p = await personalOf(ana);
  const today = new Date().toISOString().slice(0, 10);
  await seedExpense(ana, p.spaceId, p.memberId, "Cena", 2000);
  await ana.client.rpc("create_space", { p_name: "Casa de Ana y Leo", p_kind: "household", p_currency: "EUR", p_emoji: null, p_template: null, p_starts: null, p_ends: null });
  const nomina = (await ana.client.rpc("save_account", { p: { space_id: p.spaceId, name: "Santander nómina", kind: "payroll", opening_cents: 100000, opening_date: today } })).data as string;
  const ahorro = (await ana.client.rpc("save_account", { p: { space_id: p.spaceId, name: "ING ahorro", kind: "savings", opening_cents: 0, opening_date: today } })).data as string;
  await ana.client.rpc("create_transfer", { p_from: nomina, p_to: ahorro, p_amount: 5000, p_date: today, p_note: null, p_source: "manual" });
  await ana.client.rpc("save_recurring", { p: { space_id: p.spaceId, description: "Spotify", amount_cents: 1099, frequency: "monthly", day: 5, next_run: today, paid_from: "member" } });
  await ana.client.rpc("save_income", { p: { space_id: p.spaceId, member_id: p.memberId, amount_cents: 210000, source: "Nómina", received_at: today } });

  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 120)}`));
  await login(page, ana);
  for (const theme of ["dark", "light"]) {
    await page.context().addCookies([{ name: "fifti_theme", value: theme, url: page.url() }]);
    for (const route of ROUTES) {
      const res = await page.goto(route, { waitUntil: "networkidle" });
      const status = res?.status() ?? 0;
      const body = await page.locator("body").innerText();
      if (status >= 400) problems.push(`${route} (${theme}): HTTP ${status}`);
      if (/This page couldn|Application error|couldn't load/i.test(body)) problems.push(`${route} (${theme}): página de error`);
      if (/undefined|NaN|\[object/.test(body)) problems.push(`${route} (${theme}): texto roto`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) problems.push(`${route} (${theme}): desborde de ${overflow}px`);
    }
  }
  expect(problems).toEqual([]);
});
