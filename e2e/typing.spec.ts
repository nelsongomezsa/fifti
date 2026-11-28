import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eConfigured, login, newUser, openSheet, personalOf, removeUsers, seedExpense, seedPlan, type TestUser } from "./helpers";

// En una hoja se tiene que poder escribir seguido: el foco no puede saltar al panel entre tecla y tecla.
test.skip(!e2eConfigured, "Faltan las claves de pruebas");

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

/** Toca el campo una vez y teclea letra a letra con el teclado, como una persona. */
async function typeWord(page: Page, field: Locator, word: string) {
  await field.click();
  await page.keyboard.type(word, { delay: 60 });
  await expect(field).toHaveValue(word);
  await expect(field).toBeFocused();
}

async function openPage(page: Page, path: string) {
  await login(page, ana);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test("Nueva cuenta", async ({ page }) => {
  await openPage(page, "/cuentas");
  await page.getByRole("button", { name: "Nueva cuenta" }).click();
  const sheet = page.getByRole("dialog", { name: "Nueva cuenta" });
  await typeWord(page, sheet.getByLabel("Nombre"), "prueba");
  await typeWord(page, sheet.getByLabel("Banco"), "Banco Austral");
  await typeWord(page, sheet.getByLabel("Saldo inicial"), "1250,50");
  // Y la hoja sigue cerrándose con Escape
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("Traspaso → Crear cuenta", async ({ page }) => {
  await openPage(page, "/traspaso");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await typeWord(page, page.getByRole("dialog", { name: "Crear cuenta" }).getByLabel("Nombre"), "Cuenta de Leo");
});

test("Concepto de Nuevo gasto", async ({ page }) => {
  await login(page, ana);
  await openSheet(page);
  await typeWord(page, page.getByRole("dialog", { name: "Nuevo gasto" }).getByLabel("Concepto"), "Cena con amigas");
});

test("Filtros de Movimientos", async ({ page }) => {
  const p = await personalOf(ana);
  await seedExpense(ana, p.spaceId, p.memberId, "Cena", 2000);
  await openPage(page, "/movimientos");
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const field = page.getByRole("dialog", { name: "Filtros" }).getByLabel("Etiqueta");
  await typeWord(page, field, "viaje");
  // El filtro se aplica solo un momento después y vuelve a pintar la pantalla: el campo conserva el cursor
  await expect(page).toHaveURL(/tag=viaje/);
  await page.keyboard.type("lisboa", { delay: 60 });
  await expect(field).toHaveValue("viajelisboa");
  await expect(field).toBeFocused();
});

test("una fila de Ajustes con campos de texto", async ({ page }) => {
  await openPage(page, "/ajustes");
  await page.getByRole("button", { name: /^Favoritos/ }).click();
  const favorites = page.getByRole("dialog", { name: "Favoritos" });
  await typeWord(page, favorites.getByLabel("Nombre"), "Merienda");
  await favorites.getByRole("button", { name: "Cerrar" }).click();
  await page.getByRole("button", { name: /^Personal/ }).click();
  await typeWord(page, page.getByRole("dialog", { name: "Personal" }).getByLabel(/Escribe/), "Personal");
});

test("Nueva meta", async ({ page }) => {
  await openPage(page, "/plan?vista=ahorro");
  await page.getByRole("button", { name: "Nueva meta" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Nueva meta" });
  await typeWord(page, sheet.getByLabel("Nombre"), "Viaje a Japón");
  await typeWord(page, sheet.getByLabel("Objetivo"), "3000");
});
