import { expect, test } from "@playwright/test";
import { admin, e2eConfigured, login, newUser, personalOf, removeUsers, seedExpense, seedPlan, type TestUser } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas");

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

test("cuentas: crear desde Mis cuentas, verlas en Inicio y hacer un traspaso", async ({ page }) => {
  const p = await personalOf(ana);
  const today = new Date().toISOString().slice(0, 10);
  await ana.client.rpc("save_account", { p: { space_id: p.spaceId, name: "Santander nómina", bank: "Santander", kind: "payroll", opening_cents: 100000, opening_date: today } });
  await login(page, ana);
  await page.goto("/cuentas");
  await expect(page.getByRole("heading", { name: "Mis cuentas" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Nueva cuenta" }).click();
  const hoja = page.getByRole("dialog", { name: "Nueva cuenta" });
  await hoja.getByLabel("Nombre").fill("Revolut día a día");
  await hoja.getByRole("button", { name: "Día a día" }).click();
  await hoja.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Revolut día a día").first()).toBeVisible();

  await page.goto("/inicio");
  await expect(page.getByText("Tus cuentas")).toBeVisible();
  await expect(page.getByText("Santander nómina").first()).toBeVisible();

  await page.goto("/traspaso");
  await page.getByLabel("Importe").fill("30");
  await page.getByRole("button", { name: "Hacer traspaso" }).click();
  await expect.poll(async () => (await admin().from("account_transfers").select("amount_cents")).data?.some((t) => t.amount_cents === 3000), { timeout: 15_000 }).toBe(true);
});

test("Ajustes → Espacios: vaciar el espacio pide el nombre, se puede deshacer y a los 10 s borra de verdad", async ({ page }) => {
  const p = await personalOf(ana);
  await seedExpense(ana, p.spaceId, p.memberId, "Cena", 2000);
  await login(page, ana);
  await page.goto("/ajustes");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Personal/ }).click();
  const hoja = page.getByRole("dialog", { name: "Personal" });
  const vaciar = hoja.getByRole("button", { name: "Vaciar este espacio" });
  await expect(vaciar).toBeDisabled(); // hasta escribir el nombre
  await hoja.getByLabel(/Escribe/).fill("Personal");
  await vaciar.click();
  await expect(hoja.getByRole("status")).toContainText("Se vaciará en");
  await hoja.getByRole("button", { name: "Deshacer" }).click();
  expect((await admin().from("expenses").select("id").eq("space_id", p.spaceId)).data).toHaveLength(1); // nada se borró

  await vaciar.click();
  await expect(hoja.getByText("Espacio vaciado.")).toBeVisible({ timeout: 20_000 });
  expect((await admin().from("expenses").select("id").eq("space_id", p.spaceId)).data).toHaveLength(0);
});

test("Aportar al hogar desde su pantalla: crea la aportación y sale como gasto en Personal", async ({ page }) => {
  const { data: home } = await ana.client.rpc("create_space", { p_name: "Nuestro hogar", p_kind: "household", p_currency: "EUR", p_emoji: null, p_template: null, p_starts: null, p_ends: null });
  await login(page, ana);
  await page.goto("/aportar");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Importe").fill("250");
  await page.getByRole("button", { name: "Aportar al hogar" }).click();
  await expect.poll(async () => (await admin().from("contributions").select("paid_cents").eq("space_id", home as string)).data?.[0]?.paid_cents, { timeout: 15_000 }).toBe(25000);
  const p = await personalOf(ana);
  expect((await admin().from("expenses").select("amount_cents").eq("space_id", p.spaceId).like("description", "Aportación a%")).data).toEqual([{ amount_cents: 25000 }]);
});
