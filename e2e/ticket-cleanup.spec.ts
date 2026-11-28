import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { admin, e2eConfigured, login, newUser, personalOf, removeUsers, seedExpense, seedPlan, type TestUser } from "./helpers";

// Las fotos que dejan de usarse se borran del bucket privado, y nunca sin permiso.
test.skip(!e2eConfigured, "Faltan las claves de pruebas");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3113";

let ana: TestUser, leo: TestUser | undefined, spaceId: string, memberId: string;
test.beforeEach(async () => {
  ana = await newUser("Ana"); await seedPlan(ana);
  ({ spaceId, memberId } = await personalOf(ana));
});
test.afterEach(async () => { await removeUsers(ana, leo); leo = undefined; });

const photo = (color: string) => sharp({ create: { width: 30, height: 20, channels: 3, background: color } }).jpeg().toBuffer();

async function dinner(concept = "Viernes noche", space = spaceId, member = memberId) {
  await seedExpense(ana, space, member, concept, 2000);
  return (await ana.client.from("expenses").select("id").eq("description", concept).single()).data!.id as string;
}
async function upload(page: Page, expenseId: string, color = "#C8F060") {
  const res = await page.request.post("/api/ticket", { headers: { origin: BASE }, multipart: { expenseId, file: { name: "t.jpg", mimeType: "image/jpeg", buffer: await photo(color) } } });
  expect(res.status()).toBe(200);
}
/** Ficheros que hay de verdad en la carpeta del espacio. */
const stored = async (space = spaceId) => ((await admin().storage.from("receipts").list(space)).data ?? []).map((f) => `${space}/${f.name}`).sort();
const pathOf = async (id: string) => (await admin().from("expenses").select("receipt_path").eq("id", id).single()).data!.receipt_path as string | null;
const privatePathOf = async (id: string) => (await admin().from("expense_private_details").select("receipt_path").eq("expense_id", id).maybeSingle()).data?.receipt_path as string | null | undefined;

test("cambiar la foto borra la anterior y quitarla la borra del todo", async ({ page }) => {
  const id = await dinner();
  await login(page, ana);
  await upload(page, id);
  const first = (await pathOf(id))!;
  expect(await stored()).toEqual([first]);

  await upload(page, id, "#7DD3FC");
  const second = (await pathOf(id))!;
  expect(second).not.toBe(first);
  expect(await stored()).toEqual([second]);

  await page.goto(`/movimientos/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Quitar foto" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByRole("button", { name: "Añadir foto del ticket" })).toBeVisible();
  expect(await pathOf(id)).toBeNull();
  expect(await stored()).toEqual([]);
});

test("borrar el gasto borra su foto y deja las de los demás", async ({ page }) => {
  const id = await dinner();
  const other = await dinner("Viaje Lisboa");
  await login(page, ana);
  await upload(page, id);
  await upload(page, other, "#7DD3FC");
  const kept = (await pathOf(other))!;
  await page.goto(`/movimientos/${id}`);
  await page.getByRole("button", { name: "Borrar gasto", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(page).toHaveURL(/\/movimientos$/);
  expect(await stored()).toEqual([kept]);
});

test("sin permiso no se quita ni se borra nada", async ({ page, request }) => {
  const id = await dinner();
  await login(page, ana);
  await upload(page, id);
  const path = (await pathOf(id))!;
  const remove = (client: typeof request, origin = BASE) => client.delete("/api/ticket", { headers: { origin }, data: { expenseId: id } });

  expect((await remove(request)).status()).toBe(401);
  expect((await remove(page.request, "https://otra-web.example")).status()).toBe(403);
  leo = await newUser("Leo");
  await page.context().clearCookies();
  await login(page, leo);
  expect((await remove(page.request)).status()).toBe(404);
  expect(await pathOf(id)).toBe(path);
  expect(await stored()).toEqual([path]);
});

test("una ruta ajena apuntada a mano no sirve para borrar la foto de otro gasto", async ({ page }) => {
  const victim = await dinner();
  const trick = await dinner("Viaje Lisboa");
  await login(page, ana);
  await upload(page, victim);
  const path = (await pathOf(victim))!;
  // Con la API de la base se puede apuntar un gasto a la foto de otro del mismo espacio
  expect((await ana.client.rpc("attach_receipt", { p_expense: trick, p_path: path })).error).toBeNull();
  expect((await page.request.delete("/api/ticket", { headers: { origin: BASE }, data: { expenseId: trick } })).status()).toBe(200);
  expect(await stored()).toEqual([path]); // la sigue usando el primero
});

test("editar un gasto privado de un hogar conserva su foto, y al hacerlo público la deja en su sitio", async ({ page }) => {
  const home = (await ana.client.rpc("create_space", { p_name: "Casa de Ana y Leo", p_kind: "household", p_currency: "EUR", p_emoji: null, p_template: null, p_starts: null, p_ends: null })).data as string;
  const me = (await ana.client.from("space_members").select("id").eq("space_id", home).single()).data!.id as string;
  const id = await dinner("Regalo sorpresa", home, me);
  await login(page, ana, home);
  await upload(page, id);
  const path = (await pathOf(id))!;

  const edit = async (privately: boolean) => {
    await page.goto(`/movimientos/${id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Nuevo gasto" });
    await sheet.getByText("Más opciones").click();
    await sheet.getByLabel(/Gasto privado/).setChecked(privately);
    await sheet.getByRole("button", { name: /^Guardar en/ }).click();
    await expect(sheet).toHaveCount(0);
  };

  await edit(true); // pasa a privado: la foto deja de estar en la fila que ven los demás
  expect(await privatePathOf(id)).toBe(path);
  expect(await pathOf(id)).toBeNull();
  await edit(true); // editar otra vez no la pierde
  expect(await privatePathOf(id)).toBe(path);
  await edit(false);
  expect(await pathOf(id)).toBe(path);
  expect(await stored(home)).toEqual([path]);
});

test("vaciar el espacio borra todas sus fotos", async ({ page }) => {
  const id = await dinner();
  await login(page, ana);
  await upload(page, id);
  expect(await stored()).toHaveLength(1);
  await page.goto("/ajustes");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Personal/ }).click();
  const sheet = page.getByRole("dialog", { name: "Personal" });
  await sheet.getByLabel(/Escribe/).fill("Personal");
  await sheet.getByRole("button", { name: "Vaciar este espacio" }).click();
  await expect(sheet.getByText("Espacio vaciado.")).toBeVisible({ timeout: 20_000 });
  expect(await stored()).toEqual([]);
});
