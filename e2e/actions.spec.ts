import { expect, test, type Page } from "@playwright/test";
import { admin, e2eConfigured, login, newUser, openSheet, personalOf, removeUsers, seedPlan, type TestUser } from "./helpers";

// Las hojas y formularios que dependen de una server action. Que además carguen en producción (sin los paquetes
// excluidos de las funciones) lo comprueba `npm run check:runtime`.
test.skip(!e2eConfigured, "Faltan las claves de pruebas");

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

/** La hoja cargada de verdad (no el esqueleto): importe, teclado y selector de moneda. */
async function expectSheet(page: Page, currency: string) {
  const sheet = page.getByRole("dialog", { name: "Nuevo gasto" });
  await expect(sheet.locator("output")).toBeVisible();
  await expect(sheet.getByRole("group", { name: "Teclado numérico" })).toBeVisible();
  await expect(sheet.getByLabel("Moneda del gasto")).toHaveValue(currency);
}

test("+ → Gasto carga en Personal y en el hogar", async ({ page }) => {
  await ana.client.rpc("create_space", { p_name: "Casa de Ana y Leo", p_kind: "household", p_currency: "AUD", p_emoji: null, p_template: null, p_starts: null, p_ends: null });
  await login(page, ana);
  await openSheet(page);
  await expectSheet(page, "EUR");
  await page.getByRole("dialog", { name: "Nuevo gasto" }).getByRole("button", { name: "Casa de Ana y Leo", exact: true }).click();
  await expectSheet(page, "AUD");
});

test("+ → Gasto carga en la demo, y «Ver en otra moneda» responde", async ({ page }) => {
  await page.goto("/demo");
  await page.waitForLoadState("networkidle");
  await openSheet(page);
  await expectSheet(page, "EUR");
  await page.getByRole("dialog", { name: "Nuevo gasto" }).getByRole("button", { name: "Cerrar" }).click();
  await page.getByLabel("Ver totales en otra moneda").selectOption("AUD");
  await expect(page.getByRole("region", { name: "Totales en AUD" })).toBeVisible();
});

test("modo discreto se activa y se desactiva", async ({ page }) => {
  await login(page, ana);
  const button = page.locator("header").getByRole("button", { name: "Modo discreto" });
  await button.click();
  await expect(page.locator("[data-discreet=true]")).toHaveCount(1);
  await button.click();
  await expect(page.locator("[data-discreet=false]")).toHaveCount(1);
});

test("apuntar un ingreso", async ({ page }) => {
  await login(page, ana);
  await page.goto("/ingreso");
  await page.getByLabel("Importe").fill("1.800,00".replace(".", ""));
  await page.getByLabel("Origen").fill("Nómina de prueba");
  await page.getByRole("button", { name: "Guardar ingreso" }).click();
  await expect.poll(async () => (await ana.client.from("incomes").select("amount_cents, currency").eq("source", "Nómina de prueba")).data).toEqual([{ amount_cents: 180000, currency: "EUR" }]);
});

test("crear un gasto fijo", async ({ page }) => {
  await login(page, ana);
  await page.goto("/fijos/nuevo");
  await page.getByLabel("Importe").fill("25");
  await page.getByLabel("Concepto").fill("Gimnasio de Leo");
  await page.getByRole("button", { name: "Guardar gasto fijo" }).click();
  await expect(page).toHaveURL(/\/plan\?vista=fijos/);
  expect((await ana.client.from("recurring_expenses").select("amount_cents").eq("description", "Gimnasio de Leo")).data).toEqual([{ amount_cents: 2500 }]);
});

test("nueva cuenta eligiendo su moneda", async ({ page }) => {
  await login(page, ana);
  await page.goto("/cuentas");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Nueva cuenta" }).click();
  const sheet = page.getByRole("dialog", { name: "Nueva cuenta" });
  await sheet.getByLabel("Nombre").fill("Cuenta australiana");
  await sheet.getByLabel("Moneda de la cuenta").selectOption("AUD");
  await sheet.getByRole("button", { name: "Guardar", exact: true }).click();
  const p = await personalOf(ana);
  await expect.poll(async () => (await admin().from("accounts").select("currency").eq("space_id", p.spaceId)).data).toEqual([{ currency: "AUD" }]);
});
