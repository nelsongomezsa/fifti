import { expect, test } from "@playwright/test";
import { admin, e2eConfigured, login, newUser, openSheet, removeUsers, seedPlan, typeAmount, waitForExpense, type TestUser } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas (.env.test.local)");

let ana: TestUser, leo: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); leo = await newUser("Leo"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana, leo); });

test("crear el hogar e invitar a la pareja, apuntar un gasto, ver el balance y saldar", async ({ page, browser }) => {
  await login(page, ana);
  await page.waitForLoadState("networkidle"); // la página ya está hidratada
  await page.getByRole("button", { name: "Crear hogar e invitar" }).click();
  const link = await page.locator("input[readonly]").inputValue();
  expect(link).toContain("/unirse/");
  await expect(page.getByRole("link", { name: /WhatsApp/ })).toBeVisible();

  // Leo acepta la invitación desde su propia sesión
  const leoCtx = await browser.newContext({ baseURL: page.url().split("/").slice(0, 3).join("/") });
  const leoPage = await leoCtx.newPage();
  await login(leoPage, leo);
  await leoPage.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await leoPage.getByRole("button", { name: "Unirme" }).click();
  await expect(leoPage).toHaveURL(/\/(inicio|espacio)/);
  await leoCtx.close();

  // Ana pasa a la burbuja del hogar y apunta 40 € (se reparte a partes iguales)
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Nuestro hogar/ }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500); // el contexto de la hoja se refresca en segundo plano y debe incluir ya a Leo
  await openSheet(page);
  await typeAmount(page, "40");
  await page.getByLabel("Concepto").fill("Supermercado");
  await page.getByRole("button", { name: /^Guardar en/ }).click();
  await waitForExpense(ana, "Supermercado");

  await page.goto("/balance");
  await expect(page.getByText("20,00 €").first()).toBeVisible();
  await page.getByText("Saldar", { exact: true }).first().click();
  await page.getByRole("button", { name: "Marcar como pagado" }).click();
  // Solo la liquidación de este hogar: con cualquiera de la base, la prueba podía acabar (y borrar los usuarios) antes de que se guardara
  await expect.poll(async () => (await admin().from("settlements").select("id, spaces!inner(created_by)").eq("spaces.created_by", ana.id)).data?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
});
