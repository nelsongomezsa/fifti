import { expect, test, type Page } from "@playwright/test";
import { admin, e2eConfigured, login, newUser, personalOf, removeUsers, seedExpense, seedPlan, type TestUser } from "./helpers";
import { options, rowAction, swipe, swipeRow } from "./swipe-helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas");
test.use({ serviceWorkers: "block" });

const SENTENCE = "Se borran la cuenta, sus traspasos y sus ajustes. Los gastos no se borran: dejan de estar asignados a esta cuenta.";
const today = () => new Date().toISOString().slice(0, 10);

let ana: TestUser, spaceId: string, memberId: string;
test.beforeEach(async () => {
  ana = await newUser("Ana"); await seedPlan(ana);
  ({ spaceId, memberId } = await personalOf(ana));
});
test.afterEach(async () => { await removeUsers(ana); });

const account = async (name: string) =>
  (await ana.client.rpc("save_account", { p: { space_id: spaceId, name, kind: "daily", opening_cents: 100000, opening_date: today() } })).data as string;
const find = async (id: string) => (await admin().from("accounts").select("id, archived_at, is_default").eq("id", id)).data![0];

async function openAccounts(page: Page) {
  await login(page, ana);
  await page.goto("/cuentas");
  await page.waitForLoadState("networkidle");
}
const row = (page: Page, name: string) => page.getByRole("link", { name: new RegExp(name) });

test("borrar una cuenta desde la lista, con confirmación", async ({ page, isMobile }) => {
  const first = await account("Cuenta de Ana");
  const second = await account("Cuenta de Leo");
  await seedExpense(ana, spaceId, memberId, "Viernes noche", 500);
  const expense = (await ana.client.from("expenses").select("id").single()).data!.id as string;
  await ana.client.rpc("set_movement_account", { p_kind: "expense", p_id: expense, p_account: first });
  await openAccounts(page);

  await rowAction(page, isMobile, "Cuenta de Ana", "Borrar");
  await expect(page).toHaveURL(/\/cuentas$/); // deslizar no abre la cuenta
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(SENTENCE);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  expect(await find(first)).toBeDefined();

  await rowAction(page, isMobile, "Cuenta de Ana", "Borrar");
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cuenta borrada" })).toBeVisible();
  await expect(row(page, "Cuenta de Ana")).toHaveCount(0);
  await expect(page).toHaveURL(/\/cuentas$/);
  expect(await find(first)).toBeUndefined();
  expect((await find(second))!.is_default).toBe(true);
  expect((await admin().from("expenses").select("account_id").eq("id", expense).single()).data).toEqual({ account_id: null });
});

test("archivar desde la lista", async ({ page, isMobile }) => {
  const id = await account("Cuenta de Ana");
  await openAccounts(page);
  await rowAction(page, isMobile, "Cuenta de Ana", "Archivar");
  await expect(row(page, "Cuenta de Ana")).toHaveCount(0);
  expect((await find(id))!.archived_at).not.toBeNull();
});

test("«⋯» se usa con el teclado y se cierra con Escape o tocando fuera", async ({ page }) => {
  await account("Cuenta de Ana");
  await account("Cuenta de Leo");
  await openAccounts(page);
  const ana_ = options(page, "Cuenta de Ana"), leo = options(page, "Cuenta de Leo");
  await ana_.focus();
  await page.keyboard.press("Enter");
  await expect(ana_).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(ana_).toHaveAttribute("aria-expanded", "false");
  await ana_.click();
  await leo.click(); // solo una abierta a la vez
  await expect(ana_).toHaveAttribute("aria-expanded", "false");
  await expect(leo).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("heading", { name: "Mis cuentas" }).click();
  await expect(leo).toHaveAttribute("aria-expanded", "false");
});

test("con el dedo: el scroll vertical y las diagonales no descubren nada y un toque sigue abriendo", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Solo con pantalla táctil");
  const id = await account("Cuenta de Ana");
  await account("Cuenta de Leo");
  await openAccounts(page);
  const content = swipeRow(page, "Cuenta de Ana").locator("[data-swipe-content]");
  const x = async () => Math.round((await content.boundingBox())!.x);
  const start = await x();
  for (const [dx, dy] of [[-20, 0], [-20, -160], [-60, -90]] as const) {
    await swipe(page, content, dx, dy);
    await expect.poll(x).toBe(start);
  }
  await swipe(page, content, -120, 10);
  await expect.poll(x).toBe(start - 96);
  // abrir otra cierra la primera
  await swipe(page, swipeRow(page, "Cuenta de Leo").locator("[data-swipe-content]"), -120);
  await expect.poll(x).toBe(start);
  await row(page, "Cuenta de Ana").click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/${id}`));
});

test("borrar desde el detalle de la cuenta", async ({ page }) => {
  const id = await account("Cuenta de Ana");
  await openAccounts(page);
  await row(page, "Cuenta de Ana").click();
  await page.getByRole("button", { name: "Borrar cuenta" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(SENTENCE);
  await dialog.getByRole("button", { name: "Borrar" }).click();
  await expect(page).toHaveURL(/\/cuentas$/);
  await expect(page.getByRole("status").filter({ hasText: "Cuenta borrada" })).toBeVisible();
  expect(await find(id)).toBeUndefined();
});

test("vaciar el Personal con la casilla marcada deja Mis cuentas vacío", async ({ page }) => {
  await account("Cuenta de Ana");
  await account("Cuenta de Leo");
  await login(page, ana);
  await page.goto("/ajustes");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Personal/ }).click();
  const sheet = page.getByRole("dialog", { name: "Personal" });
  const box = sheet.getByRole("checkbox", { name: "Borrar también mis cuentas de este espacio" });
  await expect(box).toBeChecked(); // marcada por defecto
  await expect(sheet).toContainText("También se borran tus cuentas de este espacio");
  await box.uncheck();
  await expect(sheet).toContainText("Tus cuentas se conservan.");
  await box.check();
  await sheet.getByLabel(/Escribe/).fill("Personal");
  await sheet.getByRole("button", { name: "Vaciar este espacio" }).click();
  // «Deshacer» sigue funcionando: nada se borra antes de los 10 s
  await sheet.getByRole("button", { name: "Deshacer" }).click();
  expect((await admin().from("accounts").select("id").eq("space_id", spaceId)).data).toHaveLength(2);

  await sheet.getByRole("button", { name: "Vaciar este espacio" }).click();
  await expect(sheet.getByText("Espacio vaciado.")).toBeVisible({ timeout: 20_000 });
  await page.goto("/cuentas");
  await expect(page.getByText("Aún no tienes cuentas")).toBeVisible();
});
