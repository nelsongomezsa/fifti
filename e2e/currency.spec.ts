import { expect, test, type Page } from "@playwright/test";
import { admin, e2eConfigured, login, newUser, openSheet, personalOf, removeUsers, seedExpense, seedPlan, typeAmount, waitForExpense, type TestUser } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas");

const today = () => new Date().toISOString().slice(0, 10);
// Cambios inventados en la caché del servidor: las pruebas no llaman a ninguna API
test.beforeAll(async () => {
  const { error } = await admin().from("fx_rates").upsert([
    { day: today(), base: "EUR", quote: "AUD", rate: 1.6 },
    { day: today(), base: "AUD", quote: "EUR", rate: 0.625 },
  ]);
  if (error) throw error;
});

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

const text = async (page: Page) => (await page.locator("main").innerText()).replace(/\s/g, " ");

test("crear un espacio en AUD y apuntar en él un gasto en euros, que se convierte", async ({ page }) => {
  await login(page, ana);
  await page.goto("/nueva");
  await page.getByLabel("Nombre").fill("Viaje Lisboa");
  await page.getByLabel("Moneda").selectOption("AUD");
  await page.getByRole("button", { name: "Crear espacio" }).click();
  await expect(page).toHaveURL(/\/espacio\//);
  const { data: space } = await ana.client.from("spaces").select("id, base_currency").eq("name", "Viaje Lisboa").single();
  expect(space!.base_currency).toBe("AUD");

  await page.goto("/inicio");
  await page.getByRole("button", { name: "Viaje Lisboa" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500); // el contexto de la hoja se refresca en segundo plano
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: "Nuevo gasto" });
  await sheet.getByRole("button", { name: "Viaje Lisboa", exact: true }).click();
  await sheet.getByLabel("Moneda del gasto").selectOption("EUR");
  await typeAmount(page, "10");
  await expect(sheet.getByText(/≈ 16,00/)).toBeVisible();
  await sheet.getByLabel("Concepto").fill("Taxi");
  await sheet.getByRole("button", { name: /^Guardar en/ }).click();
  await waitForExpense(ana, "Taxi");
  const { data: saved } = await ana.client.from("expenses").select("amount_cents, currency, amount_base_cents").eq("description", "Taxi").single();
  expect(saved).toEqual({ amount_cents: 1000, currency: "EUR", amount_base_cents: 1600 });
  await page.goto("/movimientos");
  await expect.poll(() => text(page)).toContain("16,00 AUD");
});

test("cambiar la moneda del Personal: avisa, conserva el importe original y el presupuesto cuadra", async ({ page }) => {
  const p = await personalOf(ana);
  await seedExpense(ana, p.spaceId, p.memberId, "Cena", 2000);
  await login(page, ana);
  await page.goto("/ajustes");
  await page.getByRole("button", { name: /^Personal/ }).click();
  const sheet = page.getByRole("dialog", { name: "Personal" });
  await sheet.getByLabel("Moneda del espacio").selectOption("AUD");
  const warning = sheet.getByRole("alertdialog");
  await expect(warning).toContainText("no se pierden");
  await warning.getByRole("button", { name: "Cambiar a AUD" }).click();
  await expect(sheet.getByRole("status")).toContainText("Moneda cambiada");

  const { data: e } = await ana.client.from("expenses").select("amount_cents, currency, amount_base_cents").eq("description", "Cena").single();
  expect(e).toEqual({ amount_cents: 2000, currency: "EUR", amount_base_cents: 3200 });
  // Ingresos 2.000 € → 3.200 AUD y la misma proporción en cada partida
  expect((await ana.client.from("plan_incomes").select("expected_cents").single()).data!.expected_cents).toBe(320000);
  const { data: alloc } = await ana.client.from("plan_allocations").select("planned_cents");
  expect(alloc!.reduce((a, r) => a + r.planned_cents, 0)).toBe(180000 * 1.6);
  await page.goto("/plan");
  await expect.poll(() => text(page)).toContain("3.200,00 AUD");
  await expect.poll(() => text(page)).toContain("32,00 AUD");

  // Ver los totales en euros es solo una vista y se recuerda
  await page.getByLabel("Ver totales en otra moneda").selectOption("EUR");
  await expect(page.getByRole("region", { name: "Totales en EUR" })).toContainText("2.000,00 €"); // 3.200 AUD × 0,625
  await page.goto("/inicio");
  await expect(page.getByRole("region", { name: "Totales en EUR" })).toBeVisible();
  expect((await ana.client.from("spaces").select("base_currency").eq("id", p.spaceId).single()).data!.base_currency).toBe("AUD");
});

test("traspaso entre una cuenta en euros y otra en dólares australianos", async ({ page }) => {
  const p = await personalOf(ana);
  const account = async (name: string, currency: string, opening: number) =>
    (await ana.client.rpc("save_account", { p: { space_id: p.spaceId, name, kind: "daily", currency, opening_cents: opening, opening_date: today() } })).data as string;
  const eur = await account("Cuenta española", "EUR", 100000);
  const aud = await account("Cuenta australiana", "AUD", 0);
  await login(page, ana);
  await page.goto(`/traspaso?de=${eur}&a=${aud}`);
  await page.getByLabel("Importe", { exact: true }).fill("100");
  const arrives = page.getByLabel("Importe que llega");
  await expect(arrives).toHaveValue("160,00"); // propuesto con el cambio del día
  await arrives.fill("158,40"); // el banco aplicó el suyo
  await page.getByRole("button", { name: "Hacer traspaso" }).click();
  await expect.poll(async () => (await ana.client.from("account_transfers").select("amount_cents, to_amount_cents")).data).toEqual([{ amount_cents: 10000, to_amount_cents: 15840 }]);
  await page.goto("/cuentas");
  await expect.poll(() => text(page)).toContain("≈ 999,00 €"); // 900 € + 158,40 AUD × 0,625
  await expect.poll(() => text(page)).toContain("900,00 €");
  await expect.poll(() => text(page)).toContain("158,40 AUD");
});
