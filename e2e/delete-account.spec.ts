import { expect, test, type Locator, type Page } from "@playwright/test";
import { admin, e2eConfigured, login, newUser, personalOf, removeUsers, seedExpense, seedPlan, type TestUser } from "./helpers";

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
/** La fila entera (con sus dos botones escondidos detrás). */
const item = (page: Page, name: string) => page.getByRole("listitem").filter({ has: row(page, name) });

/** Arrastra la fila con el puntero (el mismo camino que el dedo: eventos de puntero). */
async function swipe(page: Page, target: Locator, dx: number, dy = 0) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test("deslizar a la izquierda y borrar, con confirmación", async ({ page }) => {
  const first = await account("Cuenta de Ana");
  const second = await account("Cuenta de Leo");
  await seedExpense(ana, spaceId, memberId, "Viernes noche", 500);
  const expense = (await ana.client.from("expenses").select("id").single()).data!.id as string;
  await ana.client.rpc("set_movement_account", { p_kind: "expense", p_id: expense, p_account: first });
  await openAccounts(page);

  await swipe(page, row(page, "Cuenta de Ana"), -150);
  await expect(page).toHaveURL(/\/cuentas$/); // deslizar no abre la cuenta
  await item(page, "Cuenta de Ana").getByRole("button", { name: "Borrar" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(SENTENCE);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  expect(await find(first)).toBeDefined();

  await swipe(page, row(page, "Cuenta de Ana"), -150);
  await item(page, "Cuenta de Ana").getByRole("button", { name: "Borrar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cuenta borrada" })).toBeVisible();
  await expect(row(page, "Cuenta de Ana")).toHaveCount(0);
  await expect(page).toHaveURL(/\/cuentas$/);
  expect(await find(first)).toBeUndefined();
  expect((await find(second))!.is_default).toBe(true);
  expect((await admin().from("expenses").select("account_id").eq("id", expense).single()).data).toEqual({ account_id: null });
});

test("deslizar a la derecha y archivar", async ({ page }) => {
  const id = await account("Cuenta de Ana");
  await openAccounts(page);
  await swipe(page, row(page, "Cuenta de Ana"), 150);
  await expect(page).toHaveURL(/\/cuentas$/);
  await item(page, "Cuenta de Ana").getByRole("button", { name: "Archivar" }).click();
  await expect(row(page, "Cuenta de Ana")).toHaveCount(0);
  expect((await find(id))!.archived_at).not.toBeNull();
});

test("un arrastre corto, vertical o en diagonal no descubre nada, y un toque sigue abriendo la cuenta", async ({ page }) => {
  const id = await account("Cuenta de Ana");
  await openAccounts(page);
  const link = row(page, "Cuenta de Ana");
  const x = async () => Math.round((await link.boundingBox())!.x);
  const start = await x();
  for (const [dx, dy] of [[-20, 0], [0, -120], [-60, -90]] as const) {
    await swipe(page, link, dx, dy);
    await expect.poll(x).toBe(start);
  }
  await expect(page).toHaveURL(/\/cuentas$/);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/${id}`));
});

test("con el dedo: deslizar de lado descubre el botón y desplazar en vertical no", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Solo con pantalla táctil");
  await account("Cuenta de Ana");
  await openAccounts(page);
  const link = row(page, "Cuenta de Ana");
  const cdp = await page.context().newCDPSession(page);
  const touch = async (dx: number, dy: number) => {
    const box = (await link.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (dx * i) / 8, y: from.y + (dy * i) / 8 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const x = async () => Math.round((await link.boundingBox())!.x);
  const start = await x();
  await touch(-20, -160);
  await expect.poll(x).toBe(start);
  await touch(-170, 10);
  await expect.poll(x).toBe(start - 112);
  await expect(item(page, "Cuenta de Ana").getByRole("button", { name: "Borrar" })).toBeVisible();
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
