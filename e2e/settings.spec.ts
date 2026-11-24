import { expect, test } from "@playwright/test";
import { e2eConfigured, login, newUser, removeUsers, seedPlan, type TestUser } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas");

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

test("Ajustes carga con sesión real, abre la hoja de cuenta y /mas redirige", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, ana);
  await page.goto("/ajustes");
  await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
  await expect(page.getByText("This page couldn")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Tu cuenta y contraseña/ }).click();
  const hoja = page.getByRole("dialog", { name: "Tu cuenta y contraseña" });
  await expect(hoja).toBeVisible();
  await expect(hoja.getByText("Borrar mi cuenta").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/mas");
  await expect(page).toHaveURL(/\/ajustes$/);
  expect(errors).toEqual([]);
});

test("el importe del gasto fijo no dibuja un contorno propio al enfocarlo", async ({ page }) => {
  await login(page, ana);
  await page.goto("/fijos/nuevo");
  const input = page.getByLabel("Importe");
  await input.focus();
  expect(await input.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
});
