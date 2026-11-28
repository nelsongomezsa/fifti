import { expect, test, type Page } from "@playwright/test";
import { admin, e2eConfigured, login, newUser, personalOf, removeUsers, seedPlan, type TestUser } from "./helpers";
import { rowAction } from "./swipe-helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas");
test.use({ serviceWorkers: "block" });

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const today = () => day(0);
const monthStart = () => `${today().slice(0, 7)}-01`;
const daysInMonth = () => new Date(Date.UTC(Number(today().slice(0, 4)), Number(today().slice(5, 7)), 0)).getUTCDate();
const money = (n: number) => new RegExp(`${String(Math.trunc(n / 1000) || "")}\\.?${String(n % 1000).padStart(n >= 1000 ? 3 : 1, "0")},00`);

let ana: TestUser, home: { spaceId: string; memberId: string };
test.beforeEach(async () => {
  ana = await newUser("Ana"); await seedPlan(ana);
  home = await personalOf(ana);
  // Cambio inventado, para no depender de la red
  for (let i = -45; i <= 0; i++) await admin().from("fx_rates").upsert({ base: "AUD", quote: "EUR", day: day(i), rate: 0.6 });
});
test.afterEach(async () => { await removeUsers(ana); });

async function open(page: Page, path: string) {
  await login(page, ana);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test("ingreso semanal en AUD: se apuntan los cobros, salen en el Calendario y el Plan cuadra", async ({ page }) => {
  const fund = (await ana.client.from("funds").select("id").eq("space_id", home.spaceId).order("position").limit(1).single()).data!;
  expect((await ana.client.rpc("save_plan", { p: { space_id: home.spaceId, month: monthStart(), incomes: [], allocations: [{ fund_id: fund.id, mode: "percent", value: 5000, planned_cents: 0 }] } })).error).toBeNull();

  const start = monthStart();
  const total = Math.floor((daysInMonth() - 1) / 7) + 1; // 4 o 5 según el mes
  const logged = Math.floor((Number(today().slice(8)) - 1) / 7) + 1;

  await open(page, "/inicio/ingresos");
  const form = page.locator("form").filter({ has: page.getByRole("combobox", { name: "Frecuencia" }) }).last();
  await form.getByRole("textbox", { name: "Importe" }).fill("650");
  await form.getByRole("combobox", { name: "Moneda del ingreso" }).selectOption("AUD");
  await form.getByRole("textbox", { name: "Origen" }).fill("Cafetería");
  await form.getByRole("combobox", { name: "Frecuencia" }).selectOption("weekly");
  await form.getByLabel("Primer cobro").fill(start);
  await form.getByRole("button", { name: "Guardar ingreso" }).click();
  await expect(page.getByRole("heading", { name: "Ingresos que se repiten" })).toBeVisible({ timeout: 20_000 });

  const rows = (await admin().from("incomes").select("amount_cents, original_amount_cents").eq("space_id", home.spaceId)).data!;
  expect(rows).toHaveLength(logged);
  expect(rows[0]).toEqual({ amount_cents: 39000, original_amount_cents: 65000 });

  const sentence = new RegExp(`Este mes cobras ${total} veces: .*${money(total * 650).source}.*AUD`);
  for (const path of ["/inicio", "/plan"]) {
    await page.goto(path);
    await expect(page.getByText(sentence)).toBeVisible();
  }
  // El 50 % de todo lo del mes, cobrado o por llegar
  await expect(page.getByText(new RegExp(`Gastado 0,00\\s€ de ${money((total * 390) / 2).source}`))).toBeVisible();

  if (total > logged) {
    await page.goto("/calendario");
    await expect(page.getByText(new RegExp(`${total - logged} cobros? por llegar`))).toBeVisible();
    await page.goto("/calendario?vista=proximos");
  } else {
    await page.goto("/calendario?vista=proximos");
  }
  await expect(page.getByRole("heading", { name: "Cobros por llegar" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Cafetería" }).first()).toContainText("AUD");
});

test("saltar el próximo cobro, pausar, reanudar y borrar la serie sin perder lo cobrado", async ({ page, isMobile }) => {
  const rule = (await ana.client.rpc("save_income_rule", { p: { space_id: home.spaceId, member_id: home.memberId, source: "Clases de Ana", amount_cents: 5000, currency: "EUR", frequency: "weekly", day: 1, next_run: today() } })).data as string;
  const state = async () => (await admin().from("income_rules").select("active, next_run").eq("id", rule).maybeSingle()).data;
  await open(page, "/inicio/ingresos");
  await page.getByRole("button", { name: "Saltar este cobro" }).click();
  await expect(page.getByRole("button", { name: "Volver a contarlo" })).toBeVisible();
  expect((await admin().from("income_skips").select("skip_on").eq("rule_id", rule)).data).toEqual([{ skip_on: (await state())!.next_run }]);

  await rowAction(page, isMobile, /Cada semana/, "Pausar");
  await expect(page.getByText("En pausa")).toBeVisible();
  expect((await state())!.active).toBe(false);
  await rowAction(page, isMobile, /Cada semana/, "Reanudar");
  await expect(page.getByText("En pausa")).toHaveCount(0);

  await rowAction(page, isMobile, /Cada semana/, "Borrar");
  await expect(page.getByRole("status").filter({ hasText: "Ingreso que se repite borrado" })).toBeVisible();
  await expect.poll(state, { timeout: 15_000 }).toBeNull();
  expect((await admin().from("incomes").select("id").eq("space_id", home.spaceId)).data).toHaveLength(1);
});

test("dos veces al mes: eligiendo los dos días, en ingresos y en gastos fijos", async ({ page }) => {
  await open(page, "/inicio/ingresos");
  const form = page.locator("form").filter({ has: page.getByRole("combobox", { name: "Frecuencia" }) }).last();
  await form.getByRole("textbox", { name: "Importe" }).fill("100");
  await form.getByRole("combobox", { name: "Frecuencia" }).selectOption("semimonthly");
  await expect(form.getByLabel("Primer día")).toHaveValue("1");
  await form.getByLabel("Primer día").fill("31"); // se ordenan solos
  await form.getByLabel("Segundo día").fill("10");
  await form.getByRole("button", { name: "Guardar ingreso" }).click();
  await expect(page.getByText(/Dos veces al mes · Próximo cobro/)).toBeVisible({ timeout: 20_000 });
  expect((await admin().from("income_rules").select("frequency, day, day2").eq("space_id", home.spaceId)).data).toEqual([{ frequency: "semimonthly", day: 10, day2: 31 }]);

  await page.goto("/fijos/nuevo");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: /Importe/ }).first().fill("12");
  await page.getByRole("textbox", { name: /Concepto/ }).fill("Seguro de Ana");
  await page.getByRole("button", { name: "2 al mes" }).click();
  await page.getByLabel("Segundo día").selectOption("20");
  await page.getByRole("button", { name: /^Guardar/ }).click();
  await expect(page).toHaveURL(/\/plan\?vista=fijos/);
  await expect(page.getByText(/Dos veces al mes · próximo/)).toBeVisible();
  expect((await admin().from("recurring_expenses").select("frequency, day, day2").eq("space_id", home.spaceId)).data).toEqual([{ frequency: "semimonthly", day: 1, day2: 20 }]);
});

test("préstamo en otra moneda", async ({ page }) => {
  await open(page, "/prestamos");
  const form = page.locator("#nuevo-prestamo");
  await form.getByRole("textbox", { name: "Persona" }).fill("Leo");
  await form.getByRole("textbox", { name: "Importe" }).fill("80");
  await form.getByRole("combobox", { name: "Moneda del préstamo" }).selectOption("AUD");
  await form.getByRole("button", { name: "Guardar préstamo" }).click();
  await expect.poll(async () => (await admin().from("loans").select("currency, amount_cents").eq("user_id", ana.id)).data).toEqual([{ currency: "AUD", amount_cents: 8000 }]);
});
