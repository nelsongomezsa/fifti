import path from "node:path";

const fixture = (name: string) => path.join(process.cwd(), "tests", "fixtures", name);
import { expect, test } from "@playwright/test";
import { admin, e2eConfigured, login, newUser, personalOf, removeUsers, seedExpense, seedPlan, type TestUser } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas (.env.test.local)");

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

test("lista de la compra: añadir, marcar y terminar la compra crea el gasto", async ({ page }) => {
  const { data: home } = await ana.client.rpc("create_space", { p_name: "Nuestro hogar", p_kind: "household", p_currency: "EUR", p_emoji: null, p_template: null, p_starts: null, p_ends: null });
  await login(page, ana, home as string);
  await page.goto("/compra");
  await page.getByLabel("Artículo").fill("Leche");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(page.getByText("Leche")).toBeVisible();
  await page.getByRole("checkbox", { name: "Leche" }).check();
  await page.getByRole("button", { name: "Terminar compra" }).click();
  await page.getByLabel("Total de la compra").fill("12,40");
  await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Compra guardada.")).toBeVisible();
  const { data } = await ana.client.from("expenses").select("amount_cents, description").eq("space_id", home as string);
  expect(data).toEqual([{ amount_cents: 1240, description: "Compra" }]);
});

test("importar un extracto del banco: formato detectado, vista previa y duplicados", async ({ page }) => {
  await login(page, ana);
  await page.goto("/csv");
  await page.locator('input[type="file"]').setInputFiles(fixture("santander.csv"));
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await expect(page.getByText("Formato detectado:")).toBeVisible();
  await expect(page.getByText("Santander", { exact: true })).toBeVisible();
  await expect(page.getByText("Repetido en el archivo")).toBeVisible(); // el segundo Netflix
  await page.getByRole("button", { name: /^Importar \d/ }).click();
  await expect(page.getByText(/Importados 3/)).toBeVisible();
  // Volver a subir el mismo archivo: todo sale como ya guardado
  await page.locator('input[type="file"]').setInputFiles(fixture("santander.csv"));
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await expect(page.getByText("Ya guardado").first()).toBeVisible();
});

test("cerrar el mes deja el plan en solo lectura", async ({ page }) => {
  const p = await personalOf(ana);
  await seedExpense(ana, p.spaceId, p.memberId, "Alquiler", 90000);
  await login(page, ana);
  await page.goto("/plan");
  await page.getByText("Cerrar el mes", { exact: true }).click();
  await page.getByRole("button", { name: "Cerrar mes", exact: true }).click();
  await expect.poll(async () => (await admin().from("monthly_plans").select("status").eq("space_id", p.spaceId)).data?.[0]?.status, { timeout: 15_000 }).toBe("closed");
});
