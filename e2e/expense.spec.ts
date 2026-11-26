import { expect, test } from "@playwright/test";
import { e2eConfigured, login, newUser, openSheet, removeUsers, seedPlan, typeAmount, waitForExpense, type TestUser } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas (.env.test.local)");

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

test("apuntar con el teclado, ver el aviso con Deshacer y que aparezca en la lista", async ({ page }) => {
  await login(page, ana);
  await openSheet(page);
  await typeAmount(page, "12,50");
  await page.getByLabel("Concepto").fill("Café con Leo");
  await page.getByRole("button", { name: /^Guardar en/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardado en" })).toBeVisible();
  await waitForExpense(ana, "Café con Leo");
  await page.goto("/movimientos");
  await expect(page.getByRole("link", { name: /Café con Leo/ })).toBeVisible();
});

test("«Pon un importe» solo sale al guardar con 0 y desaparece al teclear", async ({ page }) => {
  await login(page, ana);
  await openSheet(page);
  await expect(page.getByText("Pon un importe")).toHaveCount(0);
  await page.getByLabel("Concepto").fill("Algo");
  await page.getByRole("button", { name: /^Guardar en/ }).click();
  await expect(page.getByText("Pon un importe")).toBeVisible();
  await typeAmount(page, "3");
  await expect(page.getByText("Pon un importe")).toHaveCount(0);
});

test("Deshacer quita el gasto recién guardado", async ({ page }) => {
  await login(page, ana);
  await openSheet(page);
  await typeAmount(page, "7");
  await page.getByLabel("Concepto").fill("Para deshacer");
  await page.getByRole("button", { name: /^Guardar en/ }).click();
  const toast = page.getByRole("status").filter({ hasText: "Guardado en" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gasto deshecho" })).toBeVisible(); // ya se ha borrado de verdad
  await page.goto("/movimientos");
  await expect(page.getByRole("link", { name: /Para deshacer/ })).toHaveCount(0);
});

test("escribir una frase en el menú del + rellena la hoja pero no guarda nada", async ({ page }) => {
  await login(page, ana);
  await page.getByRole("button", { name: "Añadir gasto" }).click();
  const menu = page.getByRole("dialog", { name: "¿Qué quieres apuntar?" });
  await menu.getByLabel("Frase rápida").fill("23 súper");
  await menu.getByRole("button", { name: "Rellenar" }).click();
  await expect(page.getByRole("dialog", { name: "Nuevo gasto" })).toBeVisible();
  await expect(page.getByRole("dialog").locator("output")).toContainText("23");
  await expect(page.getByLabel("Concepto")).toHaveValue(/Súper/i);
  await expect(page.getByLabel("Escríbelo en una frase")).toHaveCount(0); // la frase vive solo en el menú del +
  await page.goto("/movimientos");
  await expect(page.getByText("Aún no hay movimientos")).toBeVisible(); // no se guardó nada solo
});

test("editar un gasto y borrarlo con la confirmación de la app", async ({ page }) => {
  const { personalOf, seedExpense } = await import("./helpers");
  const p = await personalOf(ana);
  await seedExpense(ana, p.spaceId, p.memberId, "Cena", 2000);
  await login(page, ana);
  await page.goto("/movimientos");
  await page.getByRole("link", { name: /Cena/ }).click();
  await expect(page.getByRole("heading", { name: "Cena" })).toBeVisible();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Nuevo gasto" })).toBeVisible();
  await page.getByLabel("Concepto").fill("Cena con amigas");
  await page.getByRole("button", { name: /^Guardar/ }).last().click();
  await expect(page.getByRole("heading", { name: "Cena con amigas" })).toBeVisible();
  await page.getByRole("button", { name: "Borrar", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible(); // confirmación propia, no window.confirm
  await confirm.getByRole("button", { name: "Borrar" }).click();
  await expect(page).toHaveURL(/\/movimientos$/);
  await expect(page.getByRole("link", { name: /Cena con amigas/ })).toHaveCount(0);
});
